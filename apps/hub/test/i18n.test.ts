import { expect, it } from "vitest";
import { t } from "../src/i18n.js";

it("translates the labels it knows and leaves any other text alone, prototype names included", () => {
  expect(t("fr", "Overview")).not.toBe("Overview");
  expect(t("en", "Overview")).toBe("Overview");
  for (const text of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(t("fr", text)).toBe(text);
});
