import TopNotificationsPanel from "./TopNotificationsPanel";

export default function App() {
  return <TopNotificationsPanel topN={10} pollIntervalMs={5000} />;
}
