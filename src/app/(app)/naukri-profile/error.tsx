"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function NaukriProfileError(props: ErrorPageProps) {
  return <ScreenError {...props} title="Naukri profile didn't load" />;
}
