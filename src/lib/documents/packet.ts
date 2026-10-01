import * as store from "../store";
import type { Business } from "../types";
import { planSteps } from "../workflow/engine";
import { assessCredit } from "../credit/model";
import { creditProfileFor } from "../credit/profile";
import { buildWorksheet, documentFilename, type DocumentKey } from "./worksheet";
import { attachOfficialFor, loadBlankForm, renderWorksheet } from "./pdf";
import { fillSs4, type Ss4Fill } from "./ss4-fields";

/**
 * Render one document key for one business.
 *
 * The GET route serves this as a download and the Signara route hands the same
 * bytes to a signing request, so both must produce an identical packet — hence
 * one function, not two.
 */

export interface RenderedPacket {
  bytes: Uint8Array;
  filename: string;
  officialState: "not-fetched" | "filled" | "attached-blank";
  fill: Ss4Fill | null;
}

export async function renderPacket(business: Business, key: DocumentKey): Promise<RenderedPacket> {
  const states = planSteps(business, store.listPersistedSteps(business.id));
  const credit = assessCredit(creditProfileFor(business, states, store.listTradelines(business.id)));
  const worksheet = buildWorksheet(key, business, credit);

  const official = attachOfficialFor(key) ? loadBlankForm() : null;
  const fill = official && key === "ss4" ? fillSs4(business) : null;

  const bytes = await renderWorksheet(worksheet, { attachOfficial: official, fillOfficial: fill });

  return {
    bytes,
    filename: documentFilename(key, business),
    officialState: !official ? "not-fetched" : fill ? "filled" : "attached-blank",
    fill,
  };
}
