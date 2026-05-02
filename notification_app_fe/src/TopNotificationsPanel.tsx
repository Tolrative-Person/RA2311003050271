import { useEffect, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Pagination from "@mui/material/Pagination";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import {
  getLastNotificationWarning,
  getLastNotificationDataSource,
  createTopNStreamTracker,
  fetchNotifications,
  type NotificationDataSource,
  type NotificationRecord,
  type TopNStreamTracker,
} from "./notifications/topNotifications";
import { logEvent, NOTIFICATIONS_API } from "./services/backend";
import "./TopNotificationsPanel.css";

type TopNotificationsPanelProps = {
  apiUrl?: string;
  pollIntervalMs?: number;
  topN?: number;
};

export default function TopNotificationsPanel({
  apiUrl = NOTIFICATIONS_API,
  pollIntervalMs = 5000,
  topN = 10,
}: TopNotificationsPanelProps) {
  const pageSize = 5;
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [warning, setWarning] = useState<string>("");
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [dataSource, setDataSource] = useState<NotificationDataSource>("live");
  const [currentPage, setCurrentPage] = useState<number>(1);

  const trackerRef = useRef<TopNStreamTracker | null>(null);

  useEffect(() => {
    trackerRef.current = createTopNStreamTracker(topN);
    void logEvent("frontend", "info", "component", `TopNotificationsPanel initialized with topN=${topN}`);
  }, [topN]);

  useEffect(() => {
    let disposed = false;

    const pullAndUpdate = async () => {
      try {
        const notifications = await fetchNotifications(apiUrl);
        if (disposed) return;

        setDataSource(getLastNotificationDataSource());
        setWarning(getLastNotificationWarning());

        const tracker = trackerRef.current;
        if (!tracker) return;

        tracker.ingestBatch(notifications);
        const topItems = tracker.getTopSorted();
        setItems(topItems);
        setError("");
        setLastUpdated(new Date().toLocaleTimeString());
        void logEvent("frontend", "debug", "component", `TopNotificationsPanel updated items=${topItems.length}`);
      } catch (e) {
        if (disposed) return;
        const message = e instanceof Error ? e.message : "Unexpected error while fetching notifications";
        setError(message);
        setWarning("");
        void logEvent("frontend", "error", "component", `TopNotificationsPanel fetch error=${message}`);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    pullAndUpdate();
    const timer = window.setInterval(() => {
      pullAndUpdate();
    }, pollIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [apiUrl, pollIntervalMs]);

  const heading = useMemo(() => `Top ${topN} Notifications`, [topN]);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [currentPage, items]);
  const placementCount = useMemo(() => items.filter((item) => item.type === "Placement").length, [items]);
  const resultCount = useMemo(() => items.filter((item) => item.type === "Result").length, [items]);
  const eventCount = useMemo(() => items.filter((item) => item.type === "Event").length, [items]);
  const leadNotification = items[0];

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, Math.ceil(items.length / pageSize))));
  }, [items]);

  return (
    <Box className="top-panel">
      <AppBar position="static" color="inherit" elevation={0} className="top-panel__appbar">
        <Toolbar className="top-panel__toolbar">
          <Box>
            <Typography variant="overline" className="top-panel__eyebrow">
              Campus Notifications
            </Typography>
            <Typography variant="h6" component="h1">
              Operations Console
            </Typography>
          </Box>
          <Chip
            label={dataSource === "live" ? "Live API" : "Cached fallback"}
            color={dataSource === "live" ? "success" : "warning"}
            variant="filled"
          />
        </Toolbar>
      </AppBar>

      <Card elevation={0} className="top-panel__card">
        <CardContent>
          <Stack spacing={2.5}>
            <Box className="top-panel__header">
              <Box>
                <Typography variant="h4" component="h2" gutterBottom>
                  {heading}
                </Typography>
                <Typography variant="body1" className="top-panel__subtitle">
                  Priority-ranked academic and campus updates, ordered by importance first and freshness second.
                </Typography>
              </Box>
              <Chip
                label={dataSource === "live" ? "Source: Live API" : "Source: Cached fallback"}
                color={dataSource === "live" ? "success" : "warning"}
                variant="filled"
              />
            </Box>
            <Divider />

            <Box className="top-panel__stats">
              <Paper variant="outlined" className="top-panel__stat-card">
                <Typography variant="overline" className="top-panel__stat-label">
                  Active Feed
                </Typography>
                <Typography variant="h5">{items.length}</Typography>
                <Typography variant="body2" className="top-panel__meta">
                  Notifications currently retained in the top-ranked set.
                </Typography>
              </Paper>
              <Paper variant="outlined" className="top-panel__stat-card">
                <Typography variant="overline" className="top-panel__stat-label">
                  Mix Snapshot
                </Typography>
                <Typography variant="h5">{placementCount}/{resultCount}/{eventCount}</Typography>
                <Typography variant="body2" className="top-panel__meta">
                  Placement, result, and event notifications in the current view.
                </Typography>
              </Paper>
              <Paper variant="outlined" className="top-panel__stat-card">
                <Typography variant="overline" className="top-panel__stat-label">
                  Lead Item
                </Typography>
                <Typography variant="h6">{leadNotification?.type ?? "-"}</Typography>
                <Typography variant="body2" className="top-panel__meta">
                  {leadNotification ? leadNotification.message : "Waiting for the first ranked notification."}
                </Typography>
              </Paper>
            </Box>

            {loading && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <CircularProgress size={20} />
                <Typography>Loading the latest notification feed...</Typography>
              </Box>
            )}

            {!loading && error && <Alert severity="error">Unable to load notifications. {error}</Alert>}
            {!loading && warning && !error && <Alert severity="warning">{warning}</Alert>}

            {!loading && !error && items.length === 0 && (
              <Paper variant="outlined" className="top-panel__empty">
                <Typography variant="h6">No notifications available right now</Typography>
                <Typography variant="body2" className="top-panel__meta">
                  The feed responded successfully, but there are no ranked notification items to display yet.
                </Typography>
              </Paper>
            )}

            {!loading && !error && items.length > 0 && (
              <>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} className="top-panel__meta-row">
                  <Typography variant="body2" className="top-panel__meta">
                    Last updated: {lastUpdated || "-"}
                  </Typography>
                  <Typography variant="body2" className="top-panel__meta">
                    Showing {paginatedItems.length} of {items.length} ranked notifications on page {currentPage} of {totalPages}
                  </Typography>
                </Stack>

                <TableContainer component={Paper} variant="outlined" className="top-panel__table-wrap">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableCell>Priority Type</TableCell>
                        <TableCell>Message</TableCell>
                        <TableCell>Timestamp</TableCell>
                        <TableCell>Reference</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {paginatedItems.map((n) => (
                        <TableRow key={String(n.id)} hover>
                          <TableCell>
                            <Chip
                              size="small"
                              label={n.type}
                              color={n.type === "Placement" ? "success" : n.type === "Result" ? "primary" : "warning"}
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{n.message}</TableCell>
                          <TableCell>{new Date(n.timestamp).toLocaleString()}</TableCell>
                          <TableCell>{String(n.id)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {totalPages > 1 && (
                  <Box className="top-panel__pagination">
                    <Pagination
                      count={totalPages}
                      page={currentPage}
                      onChange={(_event, page) => setCurrentPage(page)}
                      color="primary"
                      shape="rounded"
                    />
                  </Box>
                )}
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
