/* Throwaway. Deleted before commit. */
import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "./src/theme.jsx";
import { LanguageProvider } from "./src/i18n.jsx";
import MovementForm from "./src/inventory/MovementForm.jsx";
import "./src/index.css";

const UNITS = {
  mass: [{key:'mg',label:'mg'},{key:'g',label:'g'},{key:'kg',label:'kg'},{key:'oz',label:'oz'},{key:'lb',label:'lb'}],
  volume: [{key:'ml',label:'ml'},{key:'cl',label:'cl'},{key:'l',label:'L'},{key:'tsp',label:'tsp'},{key:'tbsp',label:'tbsp'},{key:'cup',label:'cup'},{key:'floz',label:'fl oz'},{key:'gal',label:'gal'}],
  count: [{key:'ea',label:'each'},{key:'dozen',label:'dozen'}],
};

createRoot(document.getElementById("root")).render(
  <ThemeProvider><LanguageProvider>
    <div className="panel" style={{ padding: 16, margin: 8 }}>
      <MovementForm
        ingredients={[{ id: "beef", name: "لحم مفروم", stockUnit: "kg" }]}
        branches={["b1", "b2"]}
        branchNames={{ b1: "الفرع الرئيسي", b2: "فرع الخليج" }}
        types={["receive", "issue", "waste", "adjust", "consume", "opening"]}
        units={UNITS}
        busy={false}
        error=""
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    </div>
  </LanguageProvider></ThemeProvider>);
