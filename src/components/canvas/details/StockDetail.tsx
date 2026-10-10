import { STOCK, formatMoney } from "@/lib/mock-run";

export function StockDetail({ matchedSku }: { matchedSku: string | null }) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        {STOCK.warehouse} · updated {STOCK.updated} · prices in {STOCK.currency}
      </p>
      <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
        {STOCK.items.map((item) => {
          const matched = item.sku === matchedSku;
          return (
            <li
              key={item.sku}
              className={`flex items-start justify-between gap-3 px-3 py-2.5 ${matched ? "bg-indigo-50" : "bg-white"}`}
            >
              <div className="min-w-0">
                <p className="font-mono text-xs font-medium text-gray-900">
                  {item.sku}
                  {matched && (
                    <span className="ml-2 rounded-full bg-indigo-600 px-1.5 py-px font-sans text-[10px] font-semibold text-white">
                      Matched
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-gray-600">{item.description}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-medium text-gray-900">{item.on_hand}</p>
                <p className="text-xs text-gray-500">{formatMoney(item.unit_price)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
