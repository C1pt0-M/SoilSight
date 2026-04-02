interface LocationLike {
  origin: string;
  pathname: string;
}

interface BuildReportRouteOptions {
  autoPrint?: boolean;
}

export const buildReportRouteHref = (
  location: LocationLike,
  options: BuildReportRouteOptions = {},
): string => {
  const base = `${location.origin}${location.pathname}`;
  return options.autoPrint ? `${base}#/report?autoprint=1` : `${base}#/report`;
};
