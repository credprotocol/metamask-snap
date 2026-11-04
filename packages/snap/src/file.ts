import type { ApiFailure } from './api';
import { getConsumerFile, getInquiries } from './api';
import type { Inquiry, KeyFactor, SnapAuth } from './types';

/** Inquiries shown on first load and added by each "Show more". */
export const INQUIRY_PAGE_SIZE = 5;

/** The dApp page with the whole file and the dispute form. */
export const FILE_URL = 'https://score.credprotocol.com/file';

/**
 * The consumer-file part of the home page. Held in the interface context
 * only, never in `snap_manageState`: who looked you up is refetched each
 * time the page opens.
 */
export type FileView = {
  /** Empty when the file could not be read or has none. */
  keyFactors: KeyFactor[];
  /** Null when the inquiry list could not be read. */
  inquiries: Inquiry[] | null;
  /** Inquiries in the whole window. */
  count: number;
  months: number;
  /** Cursor for "Show more"; null on the last page. */
  nextBefore: string | null;
  /** Set when neither call succeeded, or the last "Show more" failed. */
  error?: 'needs_sign_in' | 'unavailable';
};

/**
 * Collapse failure reasons into what the UI distinguishes.
 *
 * @param reason - Why the call failed.
 * @returns `needs_sign_in` for an expired or refused token, else `unavailable`.
 */
function viewError(reason: ApiFailure): 'needs_sign_in' | 'unavailable' {
  return reason === 'needs_sign_in' || reason === 'forbidden'
    ? 'needs_sign_in'
    : 'unavailable';
}

/**
 * Read the key factors and the first page of inquiries in parallel. Either
 * half may fail on its own; never throws.
 *
 * @param auth - The wallet token.
 * @returns The view.
 */
export async function loadFile(auth: SnapAuth): Promise<FileView> {
  const [file, page] = await Promise.all([
    getConsumerFile(auth),
    getInquiries(auth, { limit: INQUIRY_PAGE_SIZE }),
  ]);

  const view: FileView = {
    keyFactors: file.ok ? file.data.keyFactors : [],
    inquiries: page.ok ? page.data.inquiries : null,
    count: page.ok ? page.data.count : 0,
    months: page.ok ? page.data.months : 24,
    nextBefore: page.ok ? page.data.nextBefore : null,
  };
  if (!file.ok && !page.ok) {
    view.error = viewError(page.reason);
  }
  return view;
}

/**
 * Append the next page of inquiries. On failure the loaded ones are kept and
 * `error` is set. Never throws.
 *
 * @param view - The current view (must have a `nextBefore`).
 * @param auth - The wallet token.
 * @returns The updated view.
 */
export async function loadMoreInquiries(
  view: FileView,
  auth: SnapAuth,
): Promise<FileView> {
  if (!view.nextBefore) {
    return view;
  }
  const page = await getInquiries(auth, {
    limit: INQUIRY_PAGE_SIZE,
    before: view.nextBefore,
  });
  if (!page.ok) {
    return { ...view, error: viewError(page.reason) };
  }
  const { error: _previous, ...rest } = view;
  return {
    ...rest,
    inquiries: [...(view.inquiries ?? []), ...page.data.inquiries],
    count: page.data.count,
    nextBefore: page.data.nextBefore,
  };
}

const PURPOSES: Record<string, string> = {
  /* eslint-disable @typescript-eslint/naming-convention -- API enum values */
  credit_transaction: 'Credit transaction',
  account_review: 'Account review',
  collection: 'Collection',
  legitimate_business_need: 'Legitimate business need',
  /* eslint-enable @typescript-eslint/naming-convention */
};

/**
 * The purpose to show for an inquiry: the permissible purpose of a
 * consumer-report delivery (and the lender it was for), else the purpose the
 * customer declared for their key.
 *
 * @param inquiry - One inquiry.
 * @returns E.g. "Credit transaction for Acme Lending LLC", or '' when none.
 */
export function inquiryPurpose(inquiry: Inquiry): string {
  const stated = inquiry.requestPurpose
    ? (PURPOSES[inquiry.requestPurpose] ??
      inquiry.requestPurpose.replace(/_/gu, ' '))
    : (inquiry.purpose ?? '');
  if (inquiry.endUser) {
    return stated
      ? `${stated} for ${inquiry.endUser}`
      : `For ${inquiry.endUser}`;
  }
  return stated;
}

/**
 * "3 Nov 2026" from an ISO timestamp (UTC); the raw string when it will not
 * parse.
 *
 * @param iso - An ISO 8601 timestamp.
 * @returns A short date.
 */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
