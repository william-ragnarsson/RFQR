import { CircleCheck, CircleSlash, Code, TriangleAlert } from "lucide-react";
import { STOCK, formatMoney } from "@/lib/rules";
import type { InventoryResult } from "@/lib/types";
import { Note, SectionTitle } from "./shared";

export function InventorySkipped({ missing }: { missing: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
      <CircleSlash size={18} className="mt-px shrink-0 text-gray-400" />
      <div>
        <p className="font-medium">Skipped — the order form is incomplete.</p>
        {missing.length > 0 && (
          <p className="mt-0.5 text-xs text-gray-500">
            Still missing: {missing.join(", ")}. Stock is checked once the buyer answers.
          </p>
        )}
      </div>
    </div>
  );
}

export function InventoryDetail({ inventory }: { inventory: InventoryResult }) {
  const { match, fulfillable } = inventory;
  const cur = STOCK.currency;

  return (
    <div className="space-y-5">
      {fulfillable ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm font-medium text-green-800">
          <CircleCheck size={18} className="shrink-0 text-green-600" />
          Full quantity in stock
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900">
          <TriangleAlert size={18} className="shrink-0 text-amber-600" />
          {match ? "Not enough stock" : "No matching item in stock"}
        </div>
      )}

      {match && (
        <section>
          <SectionTitle>Matched SKU</SectionTitle>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="font-mono text-sm font-medium text-gray-900">{match.sku}</p>
            <p className="mt-0.5 text-sm text-gray-700">{match.description}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-gray-500">Standard</dt>
              <dd className="text-gray-800">{match.standard}</dd>
              <dt className="text-gray-500">Origin</dt>
              <dd className="text-gray-800">{match.origin}</dd>
              <dt className="text-gray-500">MTR</dt>
              <dd className="text-gray-800">{match.mtr}</dd>
            </dl>
          </div>
        </section>
      )}

      <section className="grid grid-cols-2 gap-2">
        <Stat label="Requested" value={`${inventory.requested} sheets`} />
        <Stat
          label="On hand"
          value={`${inventory.available} sheets`}
          tone={fulfillable ? "ok" : "warn"}
        />
        <Stat label="Unit price" value={match ? `${formatMoney(match.unit_price)} ${cur}` : "—"} />
        <Stat
          label="Line total"
          value={inventory.total !== null ? `${formatMoney(inventory.total)} ${cur}` : "—"}
        />
      </section>

      <p className="text-sm text-gray-700">{inventory.reason}</p>

      {!fulfillable && match && inventory.available > 0 && (
        <p className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">
          Partial option: {inventory.available} × {formatMoney(match.unit_price)} {cur} ={" "}
          <span className="font-medium text-gray-900">
            {formatMoney(inventory.available * match.unit_price)} {cur}
          </span>
        </p>
      )}

      <Note icon={<Code size={14} />}>
        Looked up in plain code: an exact match on material, grade, standard, size and finish
        against {STOCK.warehouse} ({STOCK.items.length} SKUs, updated {STOCK.updated}).
      </Note>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  const color = tone === "ok" ? "text-green-700" : tone === "warn" ? "text-amber-700" : "text-gray-900";
  return (
    <div className="rounded-lg border border-gray-200 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-sm font-medium ${color}`}>{value}</p>
    </div>
  );
}
