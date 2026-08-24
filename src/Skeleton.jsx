import { useC } from "./theme.jsx";

/* Shows the shape of the dashboard while it loads, so the layout doesn't
   jump when data lands. */
export default function Skeleton() {
  const C = useC();
  return (
    <div className="h-full overflow-hidden">
      <div className="max-w-6xl mx-auto px-5 md:px-8 py-6 md:py-8 space-y-5">
        <div className="skeleton" style={{ height: 30, width: 180 }} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel p-5">
              <div className="skeleton mb-3" style={{ height: 10, width: "55%" }} />
              <div className="skeleton mb-3" style={{ height: 26, width: "80%" }} />
              <div className="skeleton" style={{ height: 10, width: "40%" }} />
            </div>
          ))}
        </div>
        <div className="panel p-6">
          <div className="skeleton mb-4" style={{ height: 12, width: 120 }} />
          <div className="skeleton" style={{ height: 200 }} />
        </div>
        <div className="grid lg:grid-cols-2 gap-5">
          {[0, 1].map((i) => (
            <div key={i} className="panel p-6">
              <div className="skeleton mb-4" style={{ height: 12, width: 100 }} />
              <div className="skeleton" style={{ height: 150 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
