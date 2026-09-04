/**
 * Guild setup at /guilds and /guilds/[guildId].
 *
 * The pages are async server components, so they are awaited and their returned
 * element is rendered. Nothing here opens a database: setup.ts puts the process
 * in mock mode, and the fixtures carry two servers, one configured and one that
 * has never been set up.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GuildsPage from "@/app/guilds/page";
import GuildPage from "@/app/guilds/[guildId]/page";
import { GuildEditor } from "@/components/guilds/GuildEditor";
import { guildCopy, isGuildReady, readiness, type GuildView } from "@/components/guilds";
import { resetMockData } from "@/lib/mock/fixtures";

// revalidatePath is a request-scoped Next API. The pages import the action
// module, so it has to resolve, but nothing in these tests calls the action.
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const CONFIGURED_GUILD = "742118990011223344";
const UNCONFIGURED_GUILD = "742118990055667788";

const BASE: GuildView = {
  guildId: CONFIGURED_GUILD,
  customerId: "cus_northwood",
  modChannelId: "742118990011223999",
  roleBands: { "742118990011224001": "A13_15" },
  trustedRoleIds: [],
  defaultBand: "A13_15",
  defaultBandProvenance: "platform_default",
  autoTimeoutOnT2: false,
  autoTimeoutMinutes: 60,
  excludedChannelIds: [],
  enabled: true,
  updatedAt: new Date("2026-09-01T12:00:00.000Z").toISOString(),
};

beforeEach(() => {
  resetMockData();
});

describe("readiness", () => {
  it("mirrors isReady in the bot: a mod channel and scoring on, nothing else", () => {
    expect(isGuildReady({ enabled: true, modChannelId: "1" })).toBe(true);
    expect(isGuildReady({ enabled: true, modChannelId: null })).toBe(false);
    expect(isGuildReady({ enabled: false, modChannelId: "1" })).toBe(false);
  });

  it("marks exactly the two gating steps required", () => {
    const items = readiness(BASE);
    const required = items.filter((item) => item.required).map((item) => item.key);
    expect(required).toEqual(["modChannel", "enabled"]);
    expect(items.find((item) => item.key === "roleBands")?.done).toBe(true);
    expect(items.find((item) => item.key === "trustedRoleIds")?.done).toBe(false);
  });
});

describe("/guilds", () => {
  it("lists both fixture servers with their scoring state", async () => {
    render(await GuildsPage());

    expect(screen.getByRole("heading", { name: guildCopy.PAGE.listTitle })).toBeDefined();

    const table = screen.getByRole("table");
    expect(within(table).getByText(CONFIGURED_GUILD)).toBeDefined();
    expect(within(table).getByText(UNCONFIGURED_GUILD)).toBeDefined();
    expect(within(table).getByText(guildCopy.TABLE.on)).toBeDefined();
    expect(within(table).getByText(guildCopy.TABLE.off)).toBeDefined();
    expect(within(table).getByText(guildCopy.TABLE.notSet)).toBeDefined();

    const link = screen.getAllByRole("link")[0] as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/guilds/${CONFIGURED_GUILD}`);
  });
});

describe("/guilds/[guildId]", () => {
  it("renders the checklist, the band meanings and the bot's refusals", async () => {
    render(await GuildPage({ params: Promise.resolve({ guildId: CONFIGURED_GUILD }) }));

    expect(screen.getByRole("heading", { name: guildCopy.PAGE.detailTitle })).toBeDefined();
    expect(screen.getByText(guildCopy.READINESS.onWord)).toBeDefined();

    // Six bands plus unknown, each with what picking it does.
    expect(screen.getByText(guildCopy.BAND_MEANING.UNKNOWN)).toBeDefined();
    expect(screen.getByText(guildCopy.BANDS.noBirthdates)).toBeDefined();
    expect(screen.getByText(guildCopy.BANDS.provenanceNote)).toBeDefined();

    // T3 is shown and unavailable rather than hidden.
    expect(screen.getByText(guildCopy.ACTIONS.t3)).toBeDefined();
    expect(screen.getByText(guildCopy.ACTIONS.critical)).toBeDefined();

    // FORBIDDEN_ACTIONS, in the owner's words.
    for (const line of guildCopy.BOUNDARIES.not) {
      expect(screen.getByText(line)).toBeDefined();
    }
  });

  it("shows the empty state for a server this account has no row for", async () => {
    render(await GuildPage({ params: Promise.resolve({ guildId: "999999999999999999" }) }));
    expect(screen.getByText(guildCopy.STATES.notFoundTitle)).toBeDefined();
  });

  it("says why scoring cannot be turned on before a mod channel is set", async () => {
    render(await GuildPage({ params: Promise.resolve({ guildId: UNCONFIGURED_GUILD }) }));

    const enable = screen.getByRole("button", { name: guildCopy.ENABLE.turnOn });
    expect(enable.hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText(guildCopy.ENABLE.needsChannel).length).toBeGreaterThan(0);
  });
});

describe("GuildEditor", () => {
  it("validates a Discord id and then writes the mod channel through the save action", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, message: guildCopy.SAVE.ok });
    render(<GuildEditor config={{ ...BASE, modChannelId: null, enabled: false }} save={save} />);

    const input = screen.getByLabelText(guildCopy.MOD_CHANNEL.label);
    const button = screen.getByRole("button", { name: guildCopy.MOD_CHANNEL.saveLabel });

    fireEvent.change(input, { target: { value: "not-an-id" } });
    fireEvent.click(button);
    expect(screen.getByText(guildCopy.SNOWFLAKE_ERROR)).toBeDefined();
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "742118990011223999" } });
    fireEvent.click(button);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ modChannelId: "742118990011223999" });
    await screen.findByText(guildCopy.MOD_CHANNEL.saved);

    // The checklist reflects the write without a reload.
    await waitFor(() =>
      expect(screen.getAllByText(guildCopy.READINESS.doneWord, { exact: false }).length).toBeGreaterThan(0),
    );
  });

  it("asks for a second confirmation before turning the automatic timeout on", async () => {
    const save = vi.fn().mockResolvedValue({ ok: true, message: guildCopy.SAVE.ok });
    render(<GuildEditor config={BASE} save={save} />);

    fireEvent.click(screen.getByLabelText(guildCopy.ACTIONS.timeoutCheckbox));
    fireEvent.click(screen.getByRole("button", { name: guildCopy.ACTIONS.saveLabel }));

    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText(guildCopy.ACTIONS.confirmBody)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: guildCopy.ACTIONS.confirmAccept }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith({ autoTimeoutOnT2: true, autoTimeoutMinutes: 60 });
  });

  it("keeps the setting when the write is refused, and says so", async () => {
    const save = vi.fn().mockResolvedValue({ ok: false, message: guildCopy.SAVE.noRow });
    render(<GuildEditor config={BASE} save={save} />);

    fireEvent.click(screen.getByRole("button", { name: guildCopy.ENABLE.turnOff }));

    await screen.findByText(guildCopy.SAVE.noRow);
    expect(screen.getByRole("button", { name: guildCopy.ENABLE.turnOff })).toBeDefined();
  });
});
