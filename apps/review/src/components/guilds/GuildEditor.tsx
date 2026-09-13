"use client";

import { useId, useState, type ReactNode } from "react";
import { AGE_BANDS } from "@guardian/schema/agebands";
import { Button, Dialog, Toast, type ToastTone } from "@/components";
import formStyles from "@/components/Form.module.css";
import type { AgeBand, DirectoryEntry } from "@/lib/data/types";
import {
  AGE_LABEL,
  AGES,
  ALERTS,
  MODERATORS,
  PAGE,
  SAVE,
  SKIP,
  STATUS,
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

function isBand(value: string): value is AgeBand {
  return (AGE_BANDS as readonly string[]).includes(value);
}

/** A name for an id, or null when the server no longer has it. */
function nameOf(list: DirectoryEntry[], id: string): string | null {
  return list.find((entry) => entry.id === id)?.name ?? null;
}

const SELECT = `${formStyles.control} ${formStyles.select}`;

/**
 * Setting up Guardian for one Discord server.
 *
 * A status bar, then one settings panel with a row per setting: what it is on
 * the left, the control on the right. It was five cards, each with its own
 * title, accent underline and full-width rule, and the controls inside were
 * bare selects of three different sizes, a grey "Remove" box and a checkbox
 * with its duration a screen-width away. Whether Guardian is watching at all
 * was a button at the bottom of the first card. It is the first thing on the
 * page now, beside the one action that changes it.
 *
 * Every change saves as it is made, puts itself back if the save fails, and
 * says which.
 */
export function GuildEditor({ config, save }: GuildEditorProps) {
  const ids = {
    alerts: useId(),
    ages: useId(),
    mods: useId(),
    skip: useId(),
    timeout: useId(),
    length: useId(),
    statusText: useId(),
  };

  const [current, setCurrent] = useState<GuildView>(config);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const loaded = current.channels.length > 0 || current.roles.length > 0;
  const watching = current.enabled && current.modChannelId !== null;
  const alertsName = current.modChannelId ? nameOf(current.channels, current.modChannelId) : null;

  async function apply(patch: GuildPatch, message: string = SAVE.ok) {
    const before = current;
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
    <div className={styles.editor}>
      {status ? (
        <div className={styles.status}>
          <Toast message={status.message} tone={status.tone} onDismiss={() => setStatus(null)} />
        </div>
      ) : null}

      {/* Whether Guardian is watching, and the one action that changes it. */}
      <section className={styles.statusBar} data-watching={watching ? "true" : undefined} aria-label="Status">
        <span className={styles.statusDot} aria-hidden="true" />
        <p className={styles.statusText} id={ids.statusText}>
          {watching ? (
            <>
              <strong>{STATUS.watching}</strong>{" "}
              {alertsName ? (
                <span className={styles.statusDetail}>
                  {STATUS.alertsGoTo} <span className={styles.channel}>#{alertsName}</span>.
                </span>
              ) : null}
            </>
          ) : (
            <>
              <strong>{STATUS.notWatching}</strong>{" "}
              {current.modChannelId === null ? <span className={styles.statusDetail}>{STATUS.needsChannel}</span> : null}
            </>
          )}
        </p>
        {/* The sentence beside it is the reason it is disabled, so it describes the button. */}
        <Button
          variant={current.enabled ? "secondary" : "primary"}
          aria-describedby={ids.statusText}
          disabled={busy || (!current.enabled && current.modChannelId === null)}
          onClick={() =>
            void apply({ enabled: !current.enabled }, current.enabled ? ALERTS.stopped : ALERTS.started)
          }
        >
          {current.enabled ? ALERTS.stop : ALERTS.start}
        </Button>
      </section>

      {!loaded ? <p className={styles.notice}>{PAGE.notLoaded}</p> : null}

      <section className={styles.panel} aria-label={STATUS.setup}>
        <Row id={ids.alerts} label={ALERTS.label} help={ALERTS.help}>
          <select
            aria-labelledby={ids.alerts}
            className={`${SELECT} ${styles.narrow}`}
            value={current.modChannelId ?? ""}
            disabled={busy || !loaded}
            onChange={(event) => {
              const id = event.target.value || null;
              // No alerts channel means nowhere to send one, so watching stops too.
              void apply(id ? { modChannelId: id } : { modChannelId: null, enabled: false });
            }}
          >
            <option value="">{ALERTS.placeholder}</option>
            {current.channels.map((channel) => (
              <option key={channel.id} value={channel.id}>{`#${channel.name}`}</option>
            ))}
          </select>
        </Row>

        <Row id={ids.ages} label={AGES.title} help={AGES.intro}>
          <ul className={styles.ageList} aria-labelledby={ids.ages}>
            {Object.entries(current.roleBands).map(([roleId, band]) => {
              const name = nameOf(current.roles, roleId);
              const label = name ? `@${name}` : AGES.deletedRole;
              return (
                <li key={roleId} className={styles.ageRow}>
                  <span className={styles.tag} data-missing={name ? undefined : "true"}>
                    {label}
                  </span>
                  <select
                    className={SELECT}
                    aria-label={`Age for ${label}`}
                    value={band}
                    disabled={busy}
                    onChange={(event) => {
                      const next = event.target.value;
                      if (isBand(next)) void apply({ roleBands: { ...current.roleBands, [roleId]: next } });
                    }}
                  >
                    {AGE_BANDS.map((value) => (
                      <option key={value} value={value}>
                        {AGE_LABEL[value]}
                      </option>
                    ))}
                  </select>
                  <RemoveButton
                    label={`Remove ${label}`}
                    disabled={busy}
                    onRemove={() => {
                      const { [roleId]: _removed, ...rest } = current.roleBands;
                      void apply({ roleBands: rest });
                    }}
                  />
                </li>
              );
            })}
            <li className={styles.ageRow}>
              <span className={styles.everyone}>{AGES.everyoneElse}</span>
              <select
                className={SELECT}
                aria-label={AGES.everyoneElse}
                value={current.defaultBand}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  if (isBand(next)) void apply({ defaultBand: next });
                }}
              >
                {AGE_BANDS.map((value) => (
                  <option key={value} value={value}>
                    {AGE_LABEL[value]}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" />
            </li>
          </ul>
          <p className={styles.fine}>{AGES.everyoneElseHelp}</p>
          {unmappedRoles.length > 0 ? (
            <AddPicker
              label={AGES.add}
              options={unmappedRoles.map((role) => ({ value: role.id, label: `@${role.name}` }))}
              disabled={busy}
              onPick={(id) => void apply({ roleBands: { ...current.roleBands, [id]: "UNKNOWN" } })}
            />
          ) : null}
        </Row>

        <Row id={ids.mods} label={MODERATORS.title} help={MODERATORS.intro}>
          <Tags
            labelledBy={ids.mods}
            entries={current.trustedRoleIds.map((id) => {
              const name = nameOf(current.roles, id);
              return { id, label: name ? `@${name}` : AGES.deletedRole };
            })}
            empty={MODERATORS.none}
            disabled={busy}
            onRemove={(id) => void apply({ trustedRoleIds: current.trustedRoleIds.filter((r) => r !== id) })}
          />
          {unmodRoles.length > 0 ? (
            <AddPicker
              label={MODERATORS.add}
              options={unmodRoles.map((role) => ({ value: role.id, label: `@${role.name}` }))}
              disabled={busy}
              onPick={(id) => void apply({ trustedRoleIds: [...current.trustedRoleIds, id] })}
            />
          ) : null}
        </Row>

        <Row id={ids.skip} label={SKIP.title} help={SKIP.intro}>
          <Tags
            labelledBy={ids.skip}
            entries={current.excludedChannelIds.map((id) => {
              const name = nameOf(current.channels, id);
              return { id, label: name ? `#${name}` : SKIP.deletedChannel };
            })}
            empty={SKIP.none}
            disabled={busy}
            onRemove={(id) =>
              void apply({ excludedChannelIds: current.excludedChannelIds.filter((c) => c !== id) })
            }
          />
          {unskippedChannels.length > 0 ? (
            <AddPicker
              label={SKIP.add}
              options={unskippedChannels.map((channel) => ({ value: channel.id, label: `#${channel.name}` }))}
              disabled={busy}
              onPick={(id) => void apply({ excludedChannelIds: [...current.excludedChannelIds, id] })}
            />
          ) : null}
        </Row>

        <Row id={ids.timeout} label={TIMEOUT.title} help={TIMEOUT.help}>
          <div className={styles.timeout}>
            {/*
              A switch rather than a checkbox: this is a setting that is on or
              off, and it sits beside its length rather than a screen-width
              above it. Turning it on acts on an account before a person has read
              anything, so it asks once. Turning it off never does.
            */}
            <button
              type="button"
              role="switch"
              aria-checked={current.autoTimeoutOnT2}
              aria-label={TIMEOUT.checkbox}
              className={styles.switch}
              disabled={busy}
              onClick={() => {
                if (current.autoTimeoutOnT2) void apply({ autoTimeoutOnT2: false });
                else setConfirmOpen(true);
              }}
            >
              <span className={styles.switchThumb} />
            </button>
            <span className={styles.switchLabel} data-on={current.autoTimeoutOnT2 ? "true" : undefined}>
              {TIMEOUT.checkbox}
            </span>
            <label className={styles.lengthLabel} htmlFor={ids.length}>
              {TIMEOUT.lengthLabel}
            </label>
            <select
              id={ids.length}
              className={`${SELECT} ${styles.length}`}
              value={String(current.autoTimeoutMinutes)}
              disabled={busy || !current.autoTimeoutOnT2}
              onChange={(event) => void apply({ autoTimeoutMinutes: Number(event.target.value) })}
            >
              {lengths.map((length) => (
                <option key={length.minutes} value={String(length.minutes)}>
                  {length.label}
                </option>
              ))}
            </select>
          </div>
        </Row>
      </section>

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

/** One setting: what it is on the left, the control on the right. */
function Row({ id, label, help, children }: { id: string; label: string; help: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <h2 className={styles.rowLabel} id={id}>
          {label}
        </h2>
        <p className={styles.rowHelp}>{help}</p>
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  );
}

function RemoveButton({ label, disabled, onRemove }: { label: string; disabled: boolean; onRemove: () => void }) {
  return (
    <button type="button" className={styles.remove} aria-label={label} title={label} disabled={disabled} onClick={onRemove}>
      <span aria-hidden="true">×</span>
    </button>
  );
}

/** A select that adds what you pick and resets, dressed as an action. */
function AddPicker({
  label,
  options,
  disabled,
  onPick,
}: {
  label: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <select
      className={`${SELECT} ${styles.add}`}
      aria-label={label}
      value=""
      disabled={disabled}
      onChange={(event) => {
        if (event.target.value) onPick(event.target.value);
      }}
    >
      <option value="">{`+ ${label}`}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Picked roles or channels, each a tag with its own remove control. */
function Tags({
  labelledBy,
  entries,
  empty,
  disabled,
  onRemove,
}: {
  labelledBy: string;
  entries: { id: string; label: string }[];
  empty: string;
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  if (entries.length === 0) return <p className={styles.empty}>{empty}</p>;
  return (
    <ul className={styles.tags} aria-labelledby={labelledBy}>
      {entries.map((entry) => (
        <li key={entry.id} className={styles.tagItem}>
          <span className={styles.tag}>{entry.label}</span>
          <RemoveButton label={`Remove ${entry.label}`} disabled={disabled} onRemove={() => onRemove(entry.id)} />
        </li>
      ))}
    </ul>
  );
}
