import type { StyleProp, TextStyle, ViewStyle } from "react-native";

type FieldBaseProps = {
  /** Visible label rendered above the field. Omit when the screen draws its own label. */
  label?: string;
  /** Screen-reader name; defaults to `label`. Required in practice when `label` is omitted. */
  accessibilityLabel?: string;
  /** Shown when `value` is empty. */
  placeholder?: string;
  disabled?: boolean;
  /** Outer wrapper (label + field), e.g. `{ flex: 1 }` inside a row. */
  style?: StyleProp<ViewStyle>;
  /** Overrides for the tappable box, to match a screen's existing inputs. */
  fieldStyle?: StyleProp<ViewStyle>;
  /** Overrides for the value/placeholder text inside the box. */
  textStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
};

export type DateFieldProps = FieldBaseProps & {
  /** Local calendar date "YYYY-MM-DD", or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest selectable date, "YYYY-MM-DD". */
  minimumDate?: string;
  /** Latest selectable date, "YYYY-MM-DD". */
  maximumDate?: string;
  /** Where the picker opens when `value` is empty, "YYYY-MM-DD" (defaults to today, clamped to min/max). */
  initialPickerDate?: string;
};

export type TimeFieldProps = FieldBaseProps & {
  /** 24h "HH:MM", or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Where the picker opens when `value` is empty, "HH:MM" (defaults to 09:00). */
  initialPickerTime?: string;
  /** Minute step for the picker (native spinner/clock; the web input uses it as `step`). */
  minuteInterval?: 1 | 5 | 10 | 15 | 30;
};
