import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Person } from "../../apps/hub/test/harness.js";

export async function signIn(page: Page, url: string, who: Pick<Person, "email" | "password">) {
  await page.goto(`${url}/login`);
  await page.getByLabel("Email").first().fill(who.email);
  await page.getByLabel("Password").fill(who.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/console$/);
}
