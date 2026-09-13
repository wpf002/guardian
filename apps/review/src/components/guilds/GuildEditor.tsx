"use client";

import { useId, useState } from "react";
import { AGE_BANDS } from "@guardian/schema/agebands";
import { Button, Card, Dialog, Select, Toast, type ToastTone } from "@/components";
import type { AgeBand, DirectoryEntry } from "@/lib/data/types";
import {
  AGE_LABEL,
  AGES,
  ALERTS,
  MODERATORS,
  PAGE,
  SAVE,
  SKIP,
  TIMEOUT,
  TIMEOUT_LENGTHS,
} from "./copy";
import type { GuildPatch, GuildView, SaveGuild } from "./types";
import styles from "./Guilds.module.css";

export interface GuildEditorProps {
  config: GuildView;
  /** The server action, bound to this server. Passed in so a test can stub it. */
  save: SaveGuild;
}

const AGE_OPTIONS = AGE_BANDS.map((band) => ({ value: band, label: AGE_LABEL[band] }));

function isBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

/** A name for an id, or null when the server no longer has it. */
function nameOf(list: DirectoryEntry[], id: string): string | null {
  return list.find((entry) => entry.id === id)?.name ?? null;
}

/**
 * Setting up Guardian for one Discord server.
 *
 * Five cards, and every control picks from the server's own channels and roles
 * by name. This screen used to be 5,957 pixels tall: a readiness checklist
 * repeating the controls under it, seven paragraphs on what each age means to
 * the scorer, a table of T0 to T3, a list of what the bot will and will not do,
 * and a text box per setting for an 18-digit id copied with Developer Mode on.
 * A server admin could not use it without a developer next to them.
 *
 * Every change saves as it is made, and says so. There is no save button per
 * card, because a setting that looks changed and is not saved is the worst
 * thing a settings screen can do.
 */
export function GuildEditor({ config, save }: GuildEditorProps) {
  const ids = {
    channel: useId(),
    everyone: useId(),
    addAge: useId(),
    addMod: useId(),
    addSkip: useId(),
    timeoutCheck: useId(),
    timeoutLength: useId(),
  };

  const [current, setCurrent] = useState<GuildView>(config);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loaded = current.channels.length > 0 || current.roles.length > 0;

  async function apply(patch: GuildPatch, message: string = SAVE.ok) {
    const before = current;
    // Shown at once, and put back if the save fails, so the screen never claims
    // a setting the server does not have.
    setCurrent((view) => ({ ...view, ...patch }));
    setBusy(true);
    setStatus(null);
    try {
      const result = await save(patch);
      if (result.ok) {
        setStatus({ tone: "success", message });
      } else {
        setCurrent(before);
        setStatus({ tone: "warning", message: result.message });
      }
    } catch {
      setCurrent(before);
      setStatus({ tone: "warning", message: SAVE.failed });
    } finally {
      setBusy(false);
    }
  }

  const unmappedRoles = current.roles.filter((role) => !(role.id in current.roleBands));
  const unmodRoles = current.roles.filter((role) => !current.trustedRoleIds.includes(role.id));
  const unskippedChannels = current.channels.filter(
    (channel) => !current.excludedChannelIds.includes(channel.id) && channel.id !== current.modChannelId,
  );
  const lengths = TIMEOUT_LENGTHS.some((length) => length.minutes === current.autoTimeoutMinutes)
    ? TIMEOUT_LENGTHS
    : [...TIMEOUT_LENGTHS, { minutes: current.autoTimeoutMinutes, label: `${current.autoTimeoutMinutes} minutes` }];

  return (
    <div className={styles.sections}>
      {status ? (
        <div className={styles.status}>
          <Toast message={status.message} tone={status.tone} onDismiss={() => setStatus(null)} />
        </div>
      ) : null}

      {!loaded ? <p className={styles.notice}>{PAGE.notLoaded}</p> : null}

      <Card title={ALERTS.title} as="section">
        <div className={styles.inline}>
          <Select
            id={ids.channel}
            label={ALERTS.label}
            help={ALERTS.help}
            value={current.modChannelId ?? ""}
            disabled={busy || !loaded}
            options={[
              { value: "", label: ALERTS.placeholder },
              ...current.channels.map((channel) => ({ value: channel.id, label: `#${channel.name}` })),
            ]}
            onChange={(event) => {
              const id = event.target.value || null;
              // No alerts channel means nowhere to send one, so watching stops too.
              void apply(id ? { modChannelId: id } : { modChannelId: null, enabled: false });
            }}
          />
          <Button
            variant={current.enabled ? "secondary" : "primary"}
            disabled={busy || (!current.enabled && current.modChannelId === null)}
            disabledReason={!current.enabled && current.modChannelId === null ? ALERTS.needsChannel : undefined}
            onClick={() =>
              void apply(
                { enabled: !current.enabled },
                current.enabled ? ALERTS.stopped : ALERTS.started,
              )
            }
          >
            {current.enabled ? ALERTS.stop : ALERTS.start}
          </Button>
        </div>
      </Card>

      <Card title={AGES.title} as="section">
        <p className={styles.intro}>{AGES.intro}</p>
        <ul className={styles.pickList}>
          {Object.entries(current.roleBands).map(([roleId, band]) => {
            const name = nameOf(current.roles, roleId);
            return (
              <li key={roleId} className={styles.pickRow}>
                <span className={styles.pickName} data-missing={name ? undefined : "true"}>
                  {name ? `@${name}` : AGES.deletedRole}
                </span>
                <select
                  className={styles.pickSelect}
                  aria-label={`Age for ${name ?? AGES.deletedRole}`}
                  value={band}
                  disabled={busy}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (isBand(next)) void apply({ roleBands: { ...current.roleBands, [roleId]: next } });
                  }}
                >
                  {AGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.removeButton}
                  disabled={busy}
                  onClick={() => {
                    const { [roleId]: _removed, ...rest } = current.roleBands;
                    void apply({ roleBands: rest });
                  }}
                >
                  {AGES.remove}
                </button>
              </li>
            );
          })}
          <li className={styles.pickRow}>
            <span className={styles.pickName}>{AGES.everyoneElse}</span>
            <select
              id={ids.everyone}
              className={styles.pickSelect}
              aria-label={AGES.everyoneElse}
              value={current.defaultBand}
              disabled={busy}
              onChange={(event) => {
                const next = event.target.value;
                if (isBand(next)) void apply({ defaultBand: next });
              }}
            >
              {AGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* An empty third cell, so this select lines up with the ones above it. */}
            <span aria-hidden="true" />
            <span className={styles.pickHelp}>{AGES.everyoneElseHelp}</span>
          </li>
        </ul>
        {unmappedRoles.length > 0 ? (
          <AddPicker
            id={ids.addAge}
            label={AGES.add}
            options={unmappedRoles.map((role) => ({ value: role.id, label: `@${role.name}` }))}
            disabled={busy}
            onPick={(id) => void apply({ roleBands: { ...current.roleBands, [id]: "UNKNOWN" } })}
          />
        ) : null}
      </Card>

      <Card title={MODERATORS.title} as="section">
        <p className={styles.intro}>{MODERATORS.intro}</p>
        <Chips
          entries={current.trustedRoleIds.map((id) => ({ id, label: nameOf(current.roles, id) ? `@${nameOf(current.roles, id)}` : AGES.deletedRole }))}
          empty={MODERATORS.none}
          disabled={busy}
          onRemove={(id) => void apply({ trustedRoleIds: current.trustedRoleIds.filter((r) => r !== id) })}
        />
        {unmodRoles.length > 0 ? (
          <AddPicker
            id={ids.addMod}
            label={MODERATORS.add}
            options={unmodRoles.map((role) => ({ value: role.id, label: `@${role.name}` }))}
            disabled={busy}
            onPick={(id) => void apply({ trustedRoleIds: [...current.trustedRoleIds, id] })}
          />
        ) : null}
      </Card>

      <Card title={SKIP.title} as="section">
        <p className={styles.intro}>{SKIP.intro}</p>
        <Chips
          entries={current.excludedChannelIds.map((id) => ({ id, label: nameOf(current.channels, id) ? `#${nameOf(current.channels, id)}` : SKIP.deletedChannel }))}
          empty={SKIP.none}
          disabled={busy}
          onRemove={(id) => void apply({ excludedChannelIds: current.excludedChannelIds.filter((c) => c !== id) })}
        />
        {unskippedChannels.length > 0 ? (
          <AddPicker
            id={ids.addSkip}
            label={SKIP.add}
            options={unskippedChannels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))}
            disabled={busy}
            onPick={(id) => void apply({ excludedChannelIds: [...current.excludedChannelIds, id] })}
          />
        ) : null}
      </Card>

      <Card title={TIMEOUT.title} as="section">
        <div className={styles.inline}>
          <div className={styles.checkboxRow}>
            <input
              className={styles.checkbox}
              id={ids.timeoutCheck}
              type="checkbox"
              checked={current.autoTimeoutOnT2}
              disabled={busy}
              onChange={(event) => {
                // Turning it on acts on an account before a person has read
                // anything, so it asks once. Turning it off never does.
                if (event.target.checked) setConfirmOpen(true);
                else void apply({ autoTimeoutOnT2: false });
              }}
            />
            <label className={styles.checkboxLabel} htmlFor={ids.timeoutCheck}>
              {TIMEOUT.checkbox}
            </label>
          </div>
          <Select
            id={ids.timeoutLength}
            label={TIMEOUT.lengthLabel}
            value={String(current.autoTimeoutMinutes)}
            disabled={busy || !current.autoTimeoutOnT2}
            options={lengths.map((length) => ({ value: String(length.minutes), label: length.label }))}
            onChange={(event) => void apply({ autoTimeoutMinutes: Number(event.target.value) })}
          />
        </div>
      </Card>

      <Dialog
        open={confirmOpen}
        title={TIMEOUT.confirmTitle}
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {TIMEOUT.confirmCancel}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirmOpen(false);
                void apply({ autoTimeoutOnT2: true });
              }}
            >
              {TIMEOUT.confirmAccept}
            </Button>
          </>
        }
      >
        <p className={styles.body}>{TIMEOUT.confirmBody}</p>
      </Dialog>
    </div>
  );
}

/** A select that adds what you pick and then resets, so it reads as an action. */
function AddPicker({
  id,
  label,
  options,
  disabled,
  onPick,
}: {
  id: string;
  label: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <select
      id={id}
      className={styles.addPicker}
      aria-label={label}
      value=""
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value) onPick(event.target.value);
      }}
    >
      <option value="">{`${label}…`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Picked roles or channels, each with a way to take it off. */
function Chips({
  entries,
  empty,
  disabled,
  onRemove,
}: {
  entries: { id: string; label: string }[];
  empty: string;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.chips}>
      {entries.map((entry) => (
        <li key={entry.id} className={styles.chip}>
          <span>{entry.label}</span>
          <button
            type="button"
            className={styles.chipRemove}
            aria-label={`Remove ${entry.label}`}
            disabled={disabled}
            onClick={() => onRemove(entry.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
