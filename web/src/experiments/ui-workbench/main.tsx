import { createRoot } from "react-dom/client";
import { UiWorkbench } from "./UiWorkbench";

const root = document.getElementById("root");
if (!root) throw new Error("UI workbench root is missing.");

createRoot(root).render(<UiWorkbench />);
