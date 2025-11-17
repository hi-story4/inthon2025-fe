// src/api/auth.ts
import { auth } from "../firebase/firebase";

/**
 * Get API base URL based on environment
 */
function getApiBaseUrl(): string {
  const apiUrl = import.meta.env.VITE_API_URL;

  // 로컬 환경 (localhost:3000)
  if (apiUrl === "localhost:3000") {
    return "";
  }
  // ㅅ
  // 배포 환경 - VITE_API_URL 값을 그대로 사용
  // URL이 http:// 또는 https://로 시작하지 않으면 https:// 추가
  if (!apiUrl.startsWith("http://") && !apiUrl.startsWith("https://")) {
    return `https://${apiUrl}`;
  }

  return apiUrl;
}

/**
 * Build full API URL
 */
function buildApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  // endpoint가 /로 시작하면 그대로, 아니면 / 추가
  const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return `${baseUrl}${path}`;
}

/**
 * Custom error for authentication failures
 */
export class AuthError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

/**
 * Fetch wrapper with automatic auth token injection and 401/403 handling
 *
 * Features:
 * - Auto-injects Firebase ID token in Authorization header
 * - Automatically refreshes token on 401/403 and retries once
 * - Redirects to /login if token refresh fails
 * - Preserves current path for post-login redirect
 *
 * @param url - API endpoint URL
 * @param options - Standard fetch options
 * @returns Response object
 * @throws AuthError on authentication failures
 */
export async function authFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // 1) Build headers with auth token
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Merge existing headers
  if (options.headers) {
    const existingHeaders = new Headers(options.headers);
    existingHeaders.forEach((value, key) => {
      headers[key] = value;
    });
  }
  // 2) Get current user's ID token
  const user = auth.currentUser;
  if (user) {
    const token = await user.getIdToken(); // Get fresh token
    headers.Authorization = `Bearer ${token}`;
  }

  // 3) Build full API URL
  const fullUrl = buildApiUrl(url);

  // 4) Make initial request
  const response = await fetch(fullUrl, {
    ...options,
    headers,
  });

  // 5) Handle 401/403 → Attempt token refresh and retry
  if (response.status === 401 || response.status === 403) {
    try {
      const newToken = await auth.currentUser?.getIdToken(true);
      if (newToken) {
        headers.Authorization = `Bearer ${newToken}`;
        return fetch(fullUrl, { ...options, headers }); // 재요청
      }
    } catch {
      await auth.signOut();
      window.location.href = "/login";
    }
  }
  if(response.status === 406){
    alert("결제 요청이 전송되었습니다.");
  }

  return response;
}

/**
 * Fetch user profile from backend API
 */
export async function fetchUserProfile() {
  const response = await authFetch("/api/auth/login");
  return await response.json();
}

/**
 * POST request with auth
 */
export async function postWithAuth(url: string, data: unknown) {
  const response = await authFetch(url, {
    method: "POST",
    body: JSON.stringify(data),
  });
  
  // 응답이 성공적이지 않으면 에러 처리
  if (!response.ok) {
    const errorText = await response.text();
    let errorMessage = "요청에 실패했습니다.";
    
    try {
      const errorJson = JSON.parse(errorText);
      errorMessage = errorJson.message || errorMessage;
    } catch {
      // JSON 파싱 실패 시 텍스트 그대로 사용
      errorMessage = errorText || errorMessage;
    }
    
    throw new Error(errorMessage);
  }
  
  // 응답 본문이 비어있는지 확인
  const text = await response.text();
  if (!text) {
    return {};
  }
  
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error("JSON 파싱 실패:", error);
    throw new Error("응답을 파싱할 수 없습니다.");
  }
}

/**
 * @deprecated Use fetchUserProfile instead
 */
export async function getProfile() {
  return fetchUserProfile();
}

/**
 * Fetch user's candy count
 */
export async function fetchCandyCount(): Promise<{ candy: number }> {
  const response = await authFetch("/api/user/candy");
  if (!response.ok) {
    throw new Error(`Failed to fetch candy count: ${response.status} ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Spend candy to purchase an item
 */
export async function spendCandy(
  amount: number,
  itemName: string
): Promise<{ candy: number }> {
  const response = await authFetch("/api/user/spend-candy", {
    method: "POST",
    body: JSON.stringify({ amount, itemName }),
  });
  return await response.json();
}

/**
 * Get purchase history
 */
export async function getPurchaseHistory(): Promise<
  Array<{
    id: number;
    userId: number;
    type: string;
    amount: number;
    itemName: string;
    createdAt: string;
  }>
> {
  const response = await authFetch("/api/user/purchase-history");
  return await response.json();
}

/**
 * Parent-Child Management APIs
 */

export interface Child {
  id: number;
  email: string;
  name: string;
  candy: number;
}

/**
 * Get list of children for current parent
 */
export async function getChildren(): Promise<Child[]> {
  const response = await authFetch("/api/user/children");
  return await response.json();
}

/**
 * Get children count for current parent
 */
export async function getChildrenCount(): Promise<{ count: number }> {
  const response = await authFetch("/api/user/children-count");
  return await response.json();
}

/**
 * Add a child to current parent account
 */
export async function addChild(childEmail: string): Promise<Child> {
  const response = await authFetch("/api/user/children", {
    method: "POST",
    body: JSON.stringify({ childEmail }),
  });
  return await response.json();
}

/**
 * Remove a child from current parent account
 */
export async function removeChild(
  childId: number
): Promise<{ success: boolean; message: string }> {
  const response = await authFetch(`/api/user/children/${childId}`, {
    method: "DELETE",
  });
  return await response.json();
}

/**
 * Payment APIs
 */

export interface CreatePaymentRequest {
  amount: number;
  depositorName: string;
  startAt?: Date;
  endAt?: Date;
}

export interface PaymentResponse {
  id: number;
  parentId: number;
  amount: number;
  depositorName: string;
  status: "pending" | "paid" | "active" | "expired";
  startAt: Date | null;
  endAt: Date | null;
  paidAt: Date | null;
}

/**
 * Create a new payment
 */
export async function createPayment(
  payment: CreatePaymentRequest
): Promise<PaymentResponse> {
  const response = await authFetch("/api/payment/create", {
    method: "POST",
    body: JSON.stringify({ payment }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "결제 생성에 실패했습니다.");
  }

  return await response.json();
}

/**
 * Mentoring APIs
 */

export interface MentoringApplication {
  id: number;
  title: string;
  childName: string;
  childAge: string; // 중1, 중2, 중3
  status: "pending" | "matched" | "rejected" | "cancelled" | "completed";
  createdAt: string;
  mentorName?: string;
  requirement: string;
}

export interface CreateMentoringRequest {
  childId: number;
  title: string;
  childName: string;
  childAge: string; // 중1, 중2, 중3
  requirement: string;
}

/**
 * Get list of mentoring applications for current parent
 */
export async function getMentoringApplications(): Promise<
  MentoringApplication[]
> {
  const response = await authFetch("/api/mentoring/applications");
  return await response.json();
}

/**
 * Get single mentoring application detail
 */
export async function getMentoringApplication(
  id: number
): Promise<MentoringApplication> {
  const response = await authFetch(`/api/mentoring/applications/${id}`);
  return await response.json();
}

/**
 * Create a new mentoring application
 */
export async function createMentoringApplication(
  data: CreateMentoringRequest
): Promise<MentoringApplication> {
  const response = await authFetch("/api/mentoring/applications", {
    method: "POST",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "멘토링 신청에 실패했습니다.");
  }

  return await response.json();
}

/**
 * Cancel a mentoring application (only if status is 'pending')
 */
export async function cancelMentoringApplication(
  id: number
): Promise<{ success: boolean; message: string }> {
  const response = await authFetch(`/api/mentoring/applications/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "멘토링 신청 취소에 실패했습니다.");
  }

  return await response.json();
}

/**
 * Update mentoring application status (admin only)
 */
export async function updateMentoringStatus(
  id: number,
  status: "matched" | "rejected",
  mentorName?: string
): Promise<MentoringApplication> {
  const response = await authFetch(`/api/mentoring/applications/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, mentorName }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "상태 업데이트에 실패했습니다.");
  }

  return await response.json();
}

/**
 * AI Analysis APIs
 */

export interface Weakness {
  category: string;
  chapterId: number;
  chapterName: string;
  problemCount: number;
  accuracyRate: number;
  commonMistakes: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface WeaknessAnalysisResponse {
  weaknesses: Weakness[];
  recommendations: string[];
  overallScore: number;
  improvementAreas: string[];
}

export async function getWeaknessAnalysis(childId?: number): Promise<WeaknessAnalysisResponse> {
  const url = childId
    ? `/api/ai/analyze-weakness?childId=${childId}`
    : "/api/ai/analyze-weakness";

  const response = await authFetch(url, {
    method: "GET",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || "약점 분석을 불러오는데 실패했습니다.");
  }

  return await response.json();
}
