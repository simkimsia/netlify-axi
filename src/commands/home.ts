import { netlifyJson } from "../netlify.js";
import { encode, renderHelp, renderList, renderOutput } from "../toon.js";
import { siteRows, type NetlifySite } from "./list.js";
import { parseStatus, type NetlifyStatus } from "./status.js";

const HOME_SITE_LIMIT = 3;

export async function homeCommand(): Promise<string> {
  // Content first (AXI §8): show the linked site if there is one, otherwise
  // the most recently updated sites — never a usage manual.
  const linked = await netlifyJson<NetlifyStatus>(["status", "--json"]).catch(
    () => undefined,
  );

  if (linked?.siteData?.["site-name"]) {
    return renderOutput([
      encode(parseStatus(linked)),
      renderHelp([
        "Run `netlify-axi status` for linked site details",
        "Run `netlify-axi list` for all sites",
      ]),
    ]);
  }

  // Not linked (or status failed): fall through to the account-wide list and
  // let real errors (auth, CLI missing) surface from this call instead.
  const sites = await netlifyJson<NetlifySite[]>(["sites:list", "--json"]);

  const blocks: string[] = ["site: none linked to this directory"];
  const hints: string[] = [];

  if (sites.length === 0) {
    blocks.push("sites: 0 sites found in this account");
  } else {
    const rows = siteRows(sites).slice(0, HOME_SITE_LIMIT);
    blocks.push(renderList("sites", rows));
    if (sites.length > HOME_SITE_LIMIT) {
      hints.push(`Run \`netlify-axi list\` for all ${sites.length} sites`);
    }
  }

  hints.push("Run `netlify link` to link a site here");
  blocks.push(renderHelp(hints));
  return renderOutput(blocks);
}
