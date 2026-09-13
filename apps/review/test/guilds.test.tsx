/**
 * The servers list at /guilds and one server's setup at /guilds/[guildId].
 *
 * The pages are async server components, so they are awaited and rendered.
 * setup.ts puts the process in mock mode, and the fixtures carry two servers:
 * Northwood Gaming, set up, and a server the bot has joined but never loaded.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import GuildsPage from "@/app/guilds/page";
import GuildPage from "@/app/guilds/[guildId]/page";
import { GuildEditor } from "@/components/guilds/GuildEditor";
import { guildCopy, isGuildReady, type GuildView } from "@/components/guilds";
import { resetMockData } from "@/lib/mock/fixtures";

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const CONFIGURED_GUILD = "742118990011223344";
const UNLOADED_GUILD = "742118990055667788";

const BASE: GuildView = {
  guildId: CONFIGURED_GUILD,
  customerId: "cus_northwood",
  guildName: "Northwood Gaming",
  modChannelId: "742118990011223999",
  modChannelName: "mod-alerts",
  channels: [
    { id: "742118990011224200", name: "general" },
    { id: "742118990011223999", name: "mod-alerts" },
    { id: "742118990011224100", name: "staff-lounge" },
  ],
  roles: [
    { id: "742118990011224003", name: "Moderators" },
    { id: "742118990011224001", name: "Teens" },
    { id: "742118990011224004", name: "Adults" },
  ],
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

/*
 * The standard these pages are held to. A Discord id is 17 to 20 digits and is
 * never something a person should have to read or type. The words are the
 * scorer's own vocabulary, which meant nothing to the admins reading it.
 */
const DISCORD_ID = /\b\d{17,20}\b/;
const INTERNAL_WORDS =
  /\b(T[0-3]|tiers?|bands?|pairs?|signals?|kernel|fan[ -]out|provenance|lexicon|bundles?|snowflake|developer mode)\b/i;

function visibleText(container: HTMLElement): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  resetMockData();
});

describe("isGuildReady", () => {
  it("mirrors isReady in the bot: turned on, with an alerts channel", () => {
    expect(isGuildReady({ enabled: true, modChannelId: "1" })).toBe(true);
    expect(isGuildReady({ enabled: true, modChannelId: null })).toBe(false);
    expect(isGuildReady({ enabled: false, modChannelId: "1" })).toBe(false);
  });
});

describe("/guilds", () => {
  async function renderList() {
    return render(await GuildsPage());
  }

  it("lists each server by name, whether it is watching, and where alerts go", async () => {
    const { container } = await renderList();
    const table = within(screen.getByRole("table"));
    expect(table.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Server",
      "Watching",
      "Alerts Go To",
    ]);
    expect(table.getByRole("link", { name: /Northwood Gaming/ })).toBeTruthy();
    expect(table.getByText("#mod-alerts")).toBeTruthy();
    expect(table.getByRole("link", { name: /New Server/ })).toBeTruthy();
    expect(visibleText(container)).not.toMatch(DISCORD_ID);
  });

  it("says in two lines what Guardian can and cannot see", async () => {
    await renderList();
    expect(screen.getByText(guildCopy.PAGE.seesCan)).toBeTruthy();
    expect(screen.getByText(guildCopy.PAGE.seesCannot)).toBeTruthy();
  });

  it("uses no internal words", async () => {
    const { container } = await renderList();
    expect(visibleText(container)).not.toMatch(INTERNAL_WORDS);
  });
});

describe("/guilds/[guildId]", () => {
  async function renderServer(guildId: string) {
    return render(await GuildPage({ params: Promise.resolve({ guildId }) }));
  }

  it("titles the page with the server's name and says whether it is watching", async () => {
    await renderServer(CONFIGURED_GUILD);
    expect(screen.getByRole("heading", { level: 1, name: "Northwood Gaming" })).toBeTruthy();
    // Once, in the status bar. It was also a line under the title.
    expect(screen.getAllByText("Guardian is watching.")).toHaveLength(1);
  });

  it("leads with whether Guardian is watching, then five settings in order", async () => {
    await renderServer(CONFIGURED_GUILD);
    const status = within(screen.getByRole("region", { name: "Status" }));
    expect(status.getByText("Guardian is watching.")).toBeTruthy();
    expect(status.getByText("#mod-alerts")).toBeTruthy();
    expect(status.getByRole("button", { name: "Stop Watching" })).toBeTruthy();

    const settings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(settings).toEqual(["Alerts Channel", "Ages", "Moderators", "Channels to Skip", "Automatic Timeout"]);
  });

  /*
   * The page was 5,957 pixels of explanation: the UK Online Safety Act, why no
   * birthdate is stored, what each age means to the scorer, T0 to T3, and what
   * the bot will not do. And a box per setting for an 18-digit id.
   */
  it("shows no Discord id and no internal word anywhere", async () => {
    const { container } = await renderServer(CONFIGURED_GUILD);
    const text = visibleText(container);
    expect(text).not.toMatch(DISCORD_ID);
    expect(text).not.toMatch(INTERNAL_WORDS);
    expect(text).not.toMatch(/Online Safety Act|birthdate|what this bot does/i);
  });

  it("names every setting by the server's own channel and role names", async () => {
    await renderServer(CONFIGURED_GUILD);
    expect(screen.getByRole("option", { name: "#mod-alerts", selected: true })).toBeTruthy();
    const ages = within(screen.getByRole("list", { name: "Ages" }));
    expect(ages.getByText("@Teens")).toBeTruthy();
    const mods = within(screen.getByRole("list", { name: "Moderators" }));
    expect(mods.getByText("@Moderators")).toBeTruthy();
    const skip = within(screen.getByRole("list", { name: "Channels to Skip" }));
    expect(skip.getByText("#staff-lounge")).toBeTruthy();
  });

  it("says so, in one line, when the bot has not loaded the server yet", async () => {
    await renderServer(UNLOADED_GUILD);
    expect(screen.getByRole("heading", { level: 1, name: "New Server" })).toBeTruthy();
    expect(screen.getByText(guildCopy.PAGE.notLoaded)).toBeTruthy();
    expect(screen.getByText("Guardian isn't watching this server yet.")).toBeTruthy();
  });

  it("shows the not-found state for a server this account is not set up for", async () => {
    await renderServer("999999999999999999");
    expect(screen.getByText(guildCopy.STATES.notFoundTitle)).toBeTruthy();
  });
});

describe("GuildEditor", () => {
  it("saves the alerts channel as soon as one is picked", async () => {
    const save = vi.fn(async () => ({ ok: true as const, message: "Saved." }));
    render(<GuildEditor config={{ ...BASE, modChannelId: null, enabled: false }} save={save} />);

    fireEvent.change(screen.getByLabelText("Alerts Channel"), {
      target: { value: "742118990011224200" },
    });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ modChannelId: "742118990011224200" }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
  });

  it("won't start watching until an alerts channel is picked, and says why beside the button", () => {
    render(
      <GuildEditor config={{ ...BASE, modChannelId: null, enabled: false }} save={vi.fn()} />,
    );
    const start = screen.getByRole("button", { name: "Start Watching" });
    expect(start).toHaveProperty("disabled", true);
    expect(screen.getByText("Pick where alerts go, then start watching")).toBeTruthy();
    // The reason is wired to the button, not just printed near it.
    expect(document.getElementById(start.getAttribute("aria-describedby") ?? "")?.textContent).toContain(
      "Pick where alerts go",
    );
  });

  it("stops watching when the alerts channel is cleared, because there is nowhere to send one", async () => {
    const save = vi.fn(async () => ({ ok: true as const, message: "Saved." }));
    render(<GuildEditor config={BASE} save={save} />);
    fireEvent.change(screen.getByLabelText("Alerts Channel"), { target: { value: "" } });
    await waitFor(() => expect(save).toHaveBeenCalledWith({ modChannelId: null, enabled: false }));
  });

  it("adds a role to Ages by name, starting at Not sure", async () => {
    const save = vi.fn(async () => ({ ok: true as const, message: "Saved." }));
    render(<GuildEditor config={BASE} save={save} />);
    // Two "Add a role" pickers on the page: Ages first, then Moderators.
    const [addAge] = screen.getAllByRole("combobox", { name: "Add a role" });
    fireEvent.change(addAge!, { target: { value: "742118990011224004" } });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        roleBands: { "742118990011224001": "A13_15", "742118990011224004": "UNKNOWN" },
      }),
    );
    expect(within(screen.getByRole("list", { name: "Ages" })).getByText("@Adults")).toBeTruthy();
  });

  it("asks once before turning automatic timeouts on, and never before turning them off", async () => {
    const save = vi.fn(async () => ({ ok: true as const, message: "Saved." }));
    render(<GuildEditor config={BASE} save={save} />);
    const toggle = screen.getByRole("switch", { name: "Time out an account when Guardian sends an alert" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "Turn on automatic timeouts?" })).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn On" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ autoTimeoutOnT2: true }));
  });

  it("puts the setting back when the save is refused, and says so", async () => {
    const save = vi.fn(async () => ({ ok: false as const, message: "Only an operator can change this." }));
    render(<GuildEditor config={BASE} save={save} />);
    fireEvent.click(screen.getByRole("button", { name: "Stop Watching" }));
    expect(await screen.findByText("Only an operator can change this.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop Watching" })).toBeTruthy();
  });

  it("marks a role the server deleted rather than showing its id", () => {
    render(
      <GuildEditor config={{ ...BASE, roleBands: { "742118990011229999": "A16_17" } }} save={vi.fn()} />,
    );
    expect(screen.getByText("Deleted role")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(DISCORD_ID);
  });
});
