import type { Locale } from "./locales";
import type { Messages } from "./messages";

// Message keys are checked at compile time.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
