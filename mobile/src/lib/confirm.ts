// Themed confirmation sheet, replacing Alert.alert for "are you sure?" moments.
// Alert.alert is a silent no-op on react-native-web, so a confirm built on it
// never fires on the web app. <ConfirmHost /> (mounted once in app/_layout.tsx)
// renders the sheet on every platform.

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button, for actions that remove or end something. */
  destructive?: boolean;
  /**
   * Runs while the sheet stays open with a spinner on the confirm button, so
   * the person sees the action finish. Return false to keep the sheet open
   * (e.g. the request failed and the caller showed an error).
   */
  onConfirm?: () => Promise<boolean | void> | boolean | void;
};

type Request = ConfirmOptions & { resolve: (confirmed: boolean) => void };
type Listener = (request: Request) => void;
let listener: Listener | null = null;

/** Registered by <ConfirmHost />. */
export function setConfirmListener(next: Listener | null): void {
  listener = next;
}

/** Ask for confirmation. Resolves true once confirmed (after onConfirm succeeds), false on cancel. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!listener) {
      resolve(false);
      return;
    }
    listener({ ...options, resolve });
  });
}
