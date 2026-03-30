const STORAGE_KEY = "ai-noc-notif-enabled";

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

export async function requestPermission(): Promise<boolean> {
  if (!isSupported()) return false;
  const result = await Notification.requestPermission();
  const granted = result === "granted";
  setEnabled(granted);
  return granted;
}

export function isEnabled(): boolean {
  if (!isSupported()) return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

export function setEnabled(val: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(val));
}

export function sendNotification(
  title: string,
  body: string,
  onClick?: () => void,
): void {
  if (!isSupported() || Notification.permission !== "granted") return;
  const notification = new Notification(title, { body });
  const autoCloseTimer = setTimeout(() => notification.close(), 10000);
  notification.onclick = () => {
    clearTimeout(autoCloseTimer);
    notification.close();
    onClick?.();
  };
}
