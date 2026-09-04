import React from "react";
import ReactDOM from "react-dom/client";
import "./theme.css";
import PlannerApp from "./planner/PlannerApp.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PlannerApp />
  </React.StrictMode>
);
