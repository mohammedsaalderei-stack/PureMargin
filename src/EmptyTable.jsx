import { Table2 } from "lucide-react";
import { useC } from "./theme.jsx";
import { useLang } from "./i18n.jsx";

/* A business with no sales yet: an honestly empty table rather than a
   dashboard full of numbers that aren't theirs, and the way to the register,
   where the first sale is rung up. */
export default function EmptyTable({ onOpenRegister }) {
  const C = useC();
  const { t } = useLang();
  const E = t.pos.empty;
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div
          className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5"
          style={{ background: C.irisWash }}
        >
          <Table2 size={24} style={{ color: C.iris }} />
        </div>
        <h3 className="display font-extrabold text-xl mb-2">{E.title}</h3>
        <p className="text-sm leading-relaxed mb-6" style={{ color: C.slate }}>{E.lead}</p>
        <button
          onClick={onOpenRegister}
          className="px-5 py-3 rounded-full text-sm font-semibold"
          style={{ background: C.iris, color: C.onPrimary }}
        >
          {E.action}
        </button>
      </div>
    </div>
  );
}
