import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from "@opentelemetry/sdk-logs";

const posthogToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST;

let loggerProvider: LoggerProvider | null = null;

function getLoggerProvider(): LoggerProvider | null {
  if (loggerProvider) return loggerProvider;

  if (!posthogToken || !posthogHost) {
    if (process.env.NODE_ENV !== "production") {
      const missingVariable = posthogToken
        ? "NEXT_PUBLIC_POSTHOG_HOST"
        : "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN";
      console.warn(
        `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
      );
    }
    return null;
  }

  loggerProvider = new LoggerProvider({
    resource: resourceFromAttributes({
      "service.name": "my-chess-tour",
      "deployment.environment": process.env.NODE_ENV ?? "unknown",
    }),
    processors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({
          url: new URL("/i/v1/logs", posthogHost).toString(),
          timeoutMillis: 2000,
          headers: {
            Authorization: `Bearer ${posthogToken}`,
            "Content-Type": "application/json",
          },
        }),
      }),
    ],
  });

  return loggerProvider;
}

export function registerPostHogLogs() {
  getLoggerProvider();
}

export function logFeedbackSubmission(
  outcome: "filed" | "filing_failed" | "save_failed",
) {
  const logger = getLoggerProvider()?.getLogger("my-chess-tour-posthog");
  if (!logger) return;

  const severityNumber =
    outcome === "save_failed" ? SeverityNumber.ERROR : SeverityNumber.INFO;
  logger.emit({
    body: "feedback_submission_completed",
    severityNumber,
    attributes: { outcome },
  });
}

export async function flushPostHogLogs() {
  await loggerProvider?.forceFlush().catch(() => {});
}
