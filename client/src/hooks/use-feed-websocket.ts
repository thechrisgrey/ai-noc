import { useEffect } from "react";

interface WebSocketCallbacks {
  onNewItems: (count: number) => void;
  onAlert: (items: { id: number; title: string; sourceLabel: string; priority: number }[]) => void;
}

export function useFeedWebSocket(callbacks: WebSocketCallbacks) {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let attempt = 0;

    function connect() {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || "";
        let wsUrl: string;
        if (apiUrl) {
          wsUrl = apiUrl.replace(/^http/, "ws") + "/ws";
        } else {
          const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
          wsUrl = `${protocol}//${window.location.host}/ws`;
        }
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          attempt = 0;
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "new_items" && data.count > 0) {
              callbacks.onNewItems(data.count);
            }
            if (data.type === "alert" && Array.isArray(data.items)) {
              callbacks.onAlert(data.items);
            }
          } catch {}
        };

        ws.onclose = () => {
          if (disposed) return;
          reconnectTimer = setTimeout(connect, Math.min(5000 * 2 ** attempt++, 60000));
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // WebSocket not available (e.g. mixed content) — fall back to polling
      }
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      if (ws) {
        ws.onclose = null;
        try { ws.close(); } catch {}
      }
    };
  }, []);
}
