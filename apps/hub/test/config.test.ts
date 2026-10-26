import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

it("listens on loopback unless HOST says otherwise", () => {
  expect(loadConfig({ CODETGH_SECRET: "s" }).host).toBe("127.0.0.1");
  expect(loadConfig({ CODETGH_SECRET: "s", HOST: "0.0.0.0" }).host).toBe("0.0.0.0");
});

it("treats a blank MAIL_FROM, as compose passes it, like an unset one", () => {
  expect(loadConfig({ CODETGH_SECRET: "s", MAIL_FROM: "" }).mailFrom).toBeUndefined();
  expect(loadConfig({ CODETGH_SECRET: "s", MAIL_FROM: "Acme <hi@acme.test>" }).mailFrom).toBe("Acme <hi@acme.test>");
});
