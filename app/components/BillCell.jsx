import { getDue, money } from "../lib/shared";

// Bill, paid (advance + delivery charge paid) and due in one cell
export default function BillCell({ o }) {
  const total = Number(o?.total || 0), due = getDue(o), paid = Math.max(0, total - due);
  return <div className="bill">
    <div><span>Bill</span><b>{money(total)}</b></div>
    <div><span>Paid</span><b className="paid-highlight">{money(paid)}</b></div>
    <div><span>Due</span><b className={due > 0 ? "due-highlight" : "paid-highlight"}>{money(due)}</b></div>
  </div>;
}
