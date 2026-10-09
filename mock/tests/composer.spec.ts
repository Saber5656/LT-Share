import { expect, test } from "@playwright/test";

for (const device of ["iphone", "pixel-10"]) {
  test(`${device}: focused post body stays above the keyboard and footer`, async ({ page }) => {
    await page.goto("/");
    if (device === "pixel-10") {
      await page.getByTestId("device-picker").click();
      await page.getByTestId("device-option-pixel-10").click();
    }

    const screen = page.getByTestId("device-screen");
    const editor = page.getByRole("textbox", { name: "投稿文", exact: true });
    const footer = page.getByTestId("flow-fixed-footer");
    const screenBox = await screen.boundingBox();
    if (!screenBox) throw new Error("Device screen has no bounds");
    await page.mouse.move(screenBox.x + screenBox.width / 2, screenBox.y + screenBox.height / 2);
    await page.mouse.wheel(0, 1000);
    await page.waitForTimeout(400);

    const editorBox = await editor.boundingBox();
    const footerBox = await footer.boundingBox();
    if (!editorBox || !footerBox) throw new Error("Composer has no bounds");
    expect(editorBox.y + editorBox.height).toBeLessThan(footerBox.y);
    await page.mouse.click(editorBox.x + editorBox.width / 2, editorBox.y + editorBox.height / 2);
    await expect(editor).toBeFocused();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "true");
    await page.waitForTimeout(400);

    await expect.poll(async () => {
      const body = await editor.boundingBox();
      const chrome = await footer.boundingBox();
      const viewport = await page.getByTestId("mobile-scroll").boundingBox();
      return !!body && !!chrome && !!viewport &&
        body.y >= viewport.y && body.y + body.height <= chrome.y;
    }).toBe(true);

    await page.keyboard.type(" edited");
    await expect(editor).toHaveValue(/ edited/);
    await page.getByRole("button", { name: "ポスト確認", exact: true }).click();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute("data-visible", "false");
    await expect(page.getByTestId("bottom-sheet")).toBeVisible();
  });
}
