# Response · round 4

verdict: ready

Yami 0.13.0. The message box of a conversation note has a documented set of names, which are public API from this version on. Each chip has `data-setting`, and each approval button has `data-decision`. No change breaks a host.

## F3.1 · accepted · The composer's classes that a host's tests read are not documented
The README has a new table, "The message box", under Conversation notes. It lists each name that a host's styles and tests can use, with the part and the state:

- the box and its states: `.yami-composer` with `is-working`, `is-ended`, `is-unavailable`, and `has-approval`; and `.yami-has-composer` on the view's container.
- the text field: `textarea.yami-input`.
- the chips: `button.yami-chip[data-setting="model" | "effort" | "approval"]`, each with a `.yami-chip-label`. The table gives the label texts, such as `Accept edits`. The effort chip has `is-hidden` when the model has no effort levels.
- the status text: `.yami-composer-status`.
- the Send button: `button.yami-send`. It has `is-stop` and the `aria-label` `Stop (Esc)` while a turn runs and the field is empty; otherwise its `aria-label` is `Send (Enter)`. It is `disabled` when the field is empty and no turn runs, and when the field has text and no agent is left.
- `.yami-unavailable`, `.yami-ended` with its Continue it button, `.yami-approval` with `button[data-decision="allow" | "allow-session" | "deny"]`, and `.yami-suggest.is-shown` with `.yami-suggest-item.is-selected`.

Every other class in `.yami-composer`, such as `yami-composer-card` and `yami-chip-icon`, is internal. A change to a name in the table is a breaking change, and the CHANGELOG says how to migrate. A new unit test walks the box through each state of the table, so a rename fails `npm test`.

The new call sites:

```ts
const box = ".workspace-leaf.mod-active .yami-composer";
await page().waitForSelector(`${box}.is-unavailable`);
await page().fill(`${box} textarea.yami-input`, "Are you there?");
expect(await page().isDisabled(`${box} button.yami-send`)).toBe(true);
expect(await page().textContent(`${box} button.yami-chip[data-setting="approval"] .yami-chip-label`)).toBe("Accept edits");
await page().click(`${box} .yami-approval button[data-decision="allow"]`);
```

Your current selectors still work. `.yami-chip-label:text-is("Accept edits")` finds the label by its text, and that text is now documented. The `data-setting` selector also says which chip you mean.

## Policy
Add an item to Documentation in `yami/design.md`, for the user to approve: "4. A class, attribute, or text of a view that the README names for a host, such as those of the status bar and the message box, is public API. A change to one is a breaking change, with a test that pins it. The other classes of a view are internal." The earlier proposals still wait for the user. Duet's proposed changes to its own `docs/design.md` in the round 3 feedback are its own; nothing in this round changes them.
