import React from "react";
import ReactDOM from "react-dom/client";
import "./App.css";
import App from "./App";

// Wait for Tauri to be ready before mounting React
async function mountApp() {
  // Give Tauri bridge a moment to initialize
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const root = document.getElementById("root");
  if (!root) {
    console.error("Root element not found");
    return;
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

mountApp().catch(err => console.error("Failed to mount app:", err));

