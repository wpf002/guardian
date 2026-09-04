"use client";

import { useId, useState } from "react";
import { AGE_BANDS } from "@guardian/schema/agebands";
import { Button, Card, Dialog, Field, Select, Toast, type SelectOption, type ToastTone } from "@/components";
import type { AgeBand } from "@/lib/data/types";
import {
  ACTIONS,
  BANDS,
  BAND_LABEL,
  BAND_MEANING,
  ENABLE,
  EXCLUDED,
  MOD_CHANNEL,
  PROVENANCE_LABEL,
  SAVE,
  SNOWFLAKE,
  SNOWFLAKE_ERROR,
  TRUSTED,
} from "./copy";
import { BandLegend } from "./BandLegend";
import { IdListField } from "./IdListField";
import { ReadinessChecklist } from "./ReadinessChecklist";
import { RoleBandFields } from "./RoleBandFields";
import type { GuildPatch, GuildView, SaveGuild } from "./types";
import styles from "./Guilds.module.css";

const BAND_OPTIONS: SelectOption[] = AGE_BANDS.map((band) => ({
  value: band,
  label: BAND_LABEL[band],
}));

const MIN_TIMEOUT_MINUTES = 1;
/** One week, matching guildConfigSchema in apps/discord-bot/src/config.ts. */
const MAX_TIMEOUT_MINUTES = 10080;

function isBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

export interface GuildEditorProps {
  config: GuildView;
  /**
   * The server action, already bound to this guild id. Passed rather than
   * imported so the write path stays on the server and this component stays
   * testable with a stub.
   */
  save: SaveGuild;
}

type Section =
  | "enabled"
  | "modChannelId"
  | "roleBands"
  | "trustedRoleIds"
  | "excludedChannelIds"
  | "timeout";

/**
 * Every editable setting for one Discord server.
 *
 * Sections save one at a time on their own button. A single save-everything
 * button would mean an owner who fixed the mod channel also silently shipped a
 * half-finished role map, and each of these settings changes what the bot reads
 * or does.
 */
export function GuildEditor({ config, save }: GuildEditorProps) {
  const channelFieldId = useId();
  const defaultBandId = useId();
  const minutesFieldId = useId();
  const timeoutCheckboxId = useId();

  const [draft, setDraft] = useState<GuildView>(config);
  const [pending, setPending] = useState<Section | null>(null);
  const [status, setStatus] = useState<{ tone: ToastTone; message: string } | null>(null);

  const [channelDraft, setChannelDraft] = useState(config.modChannelId ?? "");
  const [channelError, setChannelError] = useState<string | null>(null);
  const [roleBands, setRoleBands] = useState(config.roleBands);
  const [defaultBand, setDefaultBand] = useState<AgeBand>(config.defaultBand);
  const [trusted, setTrusted] = useState(config.trustedRoleIds);
  const [excluded, setExcluded] = useState(config.excludedChannelIds);
  const [timeoutOn, setTimeoutOn] = useState(config.autoTimeoutOnT2);
  const [minutesDraft, setMinutesDraft] = useState(String(config.autoTimeoutMinutes));
  const [minutesError, setMinutesError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const busy = pending !== null;

  async function run(section: Section, patch: GuildPatch, message: string) {
    setPending(section);
    setStatus(null);
    try {
      const result = await save(patch);
      if (result.ok) {
        setDraft((current) => ({ ...current, ...patch }));
        // The section's own sentence, not the action's generic one: an owner
        // needs to read which setting landed, not that something did.
        setStatus({ tone: "success", message });
      } else {
        setStatus({ tone: "warning", message: result.message });
      }
    } catch {
      setStatus({ tone: "warning", message: SAVE.failed });
    } finally {
      setPending(null);
    }
  }

  function saveModChannel() {
    const trimmed = channelDraft.trim();
    if (trimmed !== "" && !SNOWFLAKE.test(trimmed)) {
      setChannelError(SNOWFLAKE_ERROR);
      return;
    }
    setChannelError(null);
    void run("modChannelId", { modChannelId: trimmed === "" ? null : trimmed }, MOD_CHANNEL.saved);
  }

  function saveTimeout(on: boolean) {
    const minutes = Number(minutesDraft);
    if (!Number.isInteger(minutes) || minutes < MIN_TIMEOUT_MINUTES || minutes > MAX_TIMEOUT_MINUTES) {
      setMinutesError(ACTIONS.timeoutMinutesError);
      return;
    }
    setMinutesError(null);
    void run("timeout", { autoTimeoutOnT2: on, autoTimeoutMinutes: minutes }, ACTIONS.saved);
  }

  function onTimeoutSave() {
    // Turning it on is an enforcement action taken before a human looks, so it
    // gets an explicit second confirmation. Turning it off never does.
    if (timeoutOn && !draft.autoTimeoutOnT2) {
      setConfirmOpen(true);
      return;
    }
    saveTimeout(timeoutOn);
  }

  const canEnable = draft.modChannelId !== null;

  return (
    <div className={styles.sections}>
      {status ? (
        <div className={styles.status}>
          <Toast
            message={status.message}
            tone={status.tone}
            onDismiss={() => setStatus(null)}
          />
        </div>
      ) : null}

      <ReadinessChecklist config={draft} />

      <Card title={ENABLE.title} as="section">
        <p className={styles.body}>{ENABLE.onNote}</p>
        <div className={styles.saveRow}>
          <Button
            variant="primary"
            loading={pending === "enabled"}
            disabledReason={!canEnable && !draft.enabled ? ENABLE.needsChannel : undefined}
            disabled={busy && pending !== "enabled"}
            onClick={() =>
              void run(
                "enabled",
                { enabled: !draft.enabled },
                draft.enabled ? ENABLE.savedOff : ENABLE.savedOn,
              )
            }
          >
            {draft.enabled ? ENABLE.turnOff : ENABLE.turnOn}
          </Button>
        </div>
      </Card>

      <Card title={MOD_CHANNEL.title} as="section">
        <p className={styles.prose}>{MOD_CHANNEL.help}</p>
        <p className={styles.prose}>{MOD_CHANNEL.clearHelp}</p>
        <div className={styles.controls}>
          <Field
            id={channelFieldId}
            label={MOD_CHANNEL.label}
            error={channelError ?? undefined}
            inputMode="numeric"
            autoComplete="off"
            value={channelDraft}
            disabled={busy}
            onChange={(event) => {
              setChannelDraft(event.target.value);
              if (channelError) setChannelError(null);
            }}
          />
          <Button
            variant="secondary"
            loading={pending === "modChannelId"}
            disabled={busy && pending !== "modChannelId"}
            onClick={saveModChannel}
          >
            {MOD_CHANNEL.saveLabel}
          </Button>
        </div>
      </Card>

      <Card title={BANDS.title} as="section">
        <p className={styles.prose}>{BANDS.intro}</p>
        <p className={styles.prose}>{BANDS.noBirthdates}</p>
        <div className={styles.note}>
          <p>{BANDS.provenanceNote}</p>
          <p>{BANDS.provenanceNoteTwo}</p>
          <p>
            {`Fallback source on this server: ${PROVENANCE_LABEL[draft.defaultBandProvenance]}.`}
          </p>
        </div>

        <div className={styles.controls}>
          <Select
            id={defaultBandId}
            label={BANDS.defaultLabel}
            help={`${BANDS.defaultHelp} ${BAND_MEANING[defaultBand]}`}
            options={BAND_OPTIONS}
            value={defaultBand}
            disabled={busy}
            onChange={(event) => {
              const next = event.target.value;
              if (isBand(next)) setDefaultBand(next);
            }}
          />
        </div>

        <BandLegend />

        <RoleBandFields value={roleBands} onChange={setRoleBands} disabled={busy} />

        <div className={styles.saveRow}>
          <Button
            variant="secondary"
            loading={pending === "roleBands"}
            disabled={busy && pending !== "roleBands"}
            onClick={() => void run("roleBands", { roleBands, defaultBand }, BANDS.saved)}
          >
            {BANDS.saveLabel}
          </Button>
        </div>
      </Card>

      <Card title={TRUSTED.title} as="section">
        <p className={styles.prose}>{TRUSTED.intro}</p>
        <p className={styles.prose}>{TRUSTED.effect}</p>
        <p className={styles.prose}>{TRUSTED.limit}</p>
        <IdListField
          label={TRUSTED.label}
          addLabel={TRUSTED.addLabel}
          itemLabel={TRUSTED.itemLabel}
          removeLabel={BANDS.removeLabel}
          emptyMessage={TRUSTED.none}
          duplicateMessage={BANDS.duplicateError}
          value={trusted}
          onChange={setTrusted}
          disabled={busy}
        />
        <div className={styles.saveRow}>
          <Button
            variant="secondary"
            loading={pending === "trustedRoleIds"}
            disabled={busy && pending !== "trustedRoleIds"}
            onClick={() => void run("trustedRoleIds", { trustedRoleIds: trusted }, TRUSTED.saved)}
          >
            {TRUSTED.saveLabel}
          </Button>
        </div>
      </Card>

      <Card title={ACTIONS.title} as="section">
        <ul className={styles.tierList}>
          <li className={styles.tierRow} data-available="true">
            <span>T0</span>
            <span>{ACTIONS.t0}</span>
          </li>
          <li className={styles.tierRow} data-available="true">
            <span>T1</span>
            <span>{ACTIONS.t1}</span>
          </li>
          <li className={styles.tierRow} data-available="true">
            <span>T2</span>
            <span>{ACTIONS.t2}</span>
          </li>
          <li className={styles.tierRow} data-available="false">
            <span>T3</span>
            <span>{ACTIONS.t3}</span>
          </li>
        </ul>
        <p className={styles.locked}>{ACTIONS.critical}</p>

        <h3 className={styles.subHeadingSpaced}>{ACTIONS.timeoutHeading}</h3>
        <p className={styles.prose}>{ACTIONS.timeoutOptIn}</p>
        <p className={styles.prose}>{ACTIONS.timeoutSupport}</p>

        <div className={styles.checkboxRow}>
          <input
            className={styles.checkbox}
            id={timeoutCheckboxId}
            type="checkbox"
            checked={timeoutOn}
            disabled={busy}
            onChange={(event) => setTimeoutOn(event.target.checked)}
          />
          <label className={styles.checkboxLabel} htmlFor={timeoutCheckboxId}>
            {ACTIONS.timeoutCheckbox}
          </label>
        </div>

        <div className={styles.controls}>
          <Field
            id={minutesFieldId}
            label={ACTIONS.timeoutMinutesLabel}
            help={ACTIONS.timeoutMinutesHelp}
            error={minutesError ?? undefined}
            type="number"
            min={MIN_TIMEOUT_MINUTES}
            max={MAX_TIMEOUT_MINUTES}
            step={1}
            value={minutesDraft}
            disabled={busy || !timeoutOn}
            onChange={(event) => {
              setMinutesDraft(event.target.value);
              if (minutesError) setMinutesError(null);
            }}
          />
          <Button
            variant="secondary"
            loading={pending === "timeout"}
            disabled={busy && pending !== "timeout"}
            onClick={onTimeoutSave}
          >
            {ACTIONS.saveLabel}
          </Button>
        </div>
      </Card>

      <Card title={EXCLUDED.title} as="section">
        <p className={styles.prose}>{EXCLUDED.intro}</p>
        <p className={styles.prose}>{EXCLUDED.note}</p>
        <IdListField
          label={EXCLUDED.label}
          addLabel={EXCLUDED.addLabel}
          itemLabel={EXCLUDED.itemLabel}
          removeLabel={BANDS.removeLabel}
          emptyMessage={EXCLUDED.none}
          duplicateMessage={BANDS.duplicateError}
          value={excluded}
          onChange={setExcluded}
          disabled={busy}
        />
        <div className={styles.saveRow}>
          <Button
            variant="secondary"
            loading={pending === "excludedChannelIds"}
            disabled={busy && pending !== "excludedChannelIds"}
            onClick={() =>
              void run("excludedChannelIds", { excludedChannelIds: excluded }, EXCLUDED.saved)
            }
          >
            {EXCLUDED.saveLabel}
          </Button>
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        title={ACTIONS.confirmTitle}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setTimeoutOn(false);
                setConfirmOpen(false);
              }}
            >
              {ACTIONS.confirmCancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOpen(false);
                saveTimeout(true);
              }}
            >
              {ACTIONS.confirmAccept}
            </Button>
          </>
        }
      >
        <p className={styles.body}>{ACTIONS.confirmBody}</p>
        <p className={styles.note}>{ACTIONS.timeoutSupport}</p>
      </Dialog>
    </div>
  );
}
