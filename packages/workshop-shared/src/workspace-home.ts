// The canonical Workspace Home: a gadget that lists every other gadget of its workspace, read live
// from env.WORKSPACE at render time, with rows that open their gadget in place (data-workpiece-id)
// and every column sortable and filterable, its view state kept in the page URL (gadgetView).
//
// The agent's system prompt shows this code verbatim, and workshop-frontend's browser tests run it
// in a real gadget frame, so the snippet agents copy is the one that is tested.

export const WORKSPACE_HOME_SERVER_JS = `\
// server.js
import { DurableObject } from "cloudflare:workers";
export class Gadget extends DurableObject {
  async listGadgets() {
    return (await this.env.WORKSPACE.listGadgets()).filter(g => !g.self);
  }
}
`;

export const WORKSPACE_HOME_CLIENT_JS = `\
// client.js
let columns = [
  { key: "title", label: "Gadget", value: g => g.title },
  { key: "id", label: "ID", value: g => g.id },
];
let gadgets = await gadget.listGadgets();
let view = gadgetView.params;
let table = document.createElement("table");
let head = table.createTHead(), labels = head.insertRow(), filters = head.insertRow();
let body = table.createTBody();
document.body.append(table);

for (let c of columns) {
  let th = document.createElement("th");
  th.style.cursor = "pointer";
  th.onclick = () => {
    let asc = view.get("sort") !== c.key || view.get("dir") === "desc";
    view.set("sort", c.key);
    view.set("dir", asc ? "asc" : "desc");
    gadgetView.set(view);
    render();
  };
  labels.append(th);
  let input = document.createElement("input");
  input.placeholder = "Filter";
  input.value = view.get("f." + c.key) ?? "";
  input.oninput = () => {
    if (input.value) view.set("f." + c.key, input.value); else view.delete("f." + c.key);
    gadgetView.set(view);
    render();
  };
  filters.insertCell().append(input);
}

function render() {
  let sortCol = columns.find(c => c.key === view.get("sort")) ?? columns[0];
  let dir = view.get("dir") === "desc" ? -1 : 1;
  columns.forEach((c, i) => {
    labels.cells[i].textContent = c.label + (c === sortCol ? (dir > 0 ? " ▲" : " ▼") : "");
  });
  let rows = gadgets.filter(g => columns.every(c => {
    let f = (view.get("f." + c.key) ?? "").toLowerCase();
    return !f || String(c.value(g)).toLowerCase().includes(f);
  }));
  rows.sort((a, b) => {
    let x = sortCol.value(a), y = sortCol.value(b);
    return dir * (typeof x === "number" ? x - y : String(x).localeCompare(String(y)));
  });
  body.replaceChildren();
  for (let g of rows) {
    let tr = body.insertRow();
    tr.dataset.workpieceId = String(g.id);  // the click opens this gadget
    tr.style.cursor = "pointer";
    for (let c of columns) tr.insertCell().textContent = String(c.value(g));
  }
}
render();
`;
