import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

// The data layer runs against fixtures in these tests. Nothing here opens a
// database connection, and getPrisma throws if something tries.
beforeAll(() => {
  process.env.GUARDIAN_MOCK = "1";
});

afterEach(() => {
  cleanup();
});
