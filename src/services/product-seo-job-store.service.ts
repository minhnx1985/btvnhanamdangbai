import { randomUUID } from "node:crypto";
import { ProductSeoBookUnderstandingJob, ProductSeoPendingJob } from "../types/product-seo.types";

type ProductSeoDetectedUrlJob = {
  type: "product_seo_detected_url";
  jobId: string;
  userId: number;
  alias: string;
  createdAt: number;
};

const PRODUCT_SEO_JOB_TTL_MS = 30 * 60 * 1000;
const pendingUpdateJobs = new Map<string, ProductSeoPendingJob>();
const bookUnderstandingJobs = new Map<string, ProductSeoBookUnderstandingJob>();
const detectedUrlJobs = new Map<string, ProductSeoDetectedUrlJob>();
const enrichmentWaitByUser = new Map<number, string>();

function isExpired(createdAt: number): boolean {
  return Date.now() - createdAt > PRODUCT_SEO_JOB_TTL_MS;
}

function pruneExpiredJobs(): void {
  for (const [jobId, job] of pendingUpdateJobs.entries()) {
    if (isExpired(job.createdAt)) {
      pendingUpdateJobs.delete(jobId);
    }
  }

  for (const [jobId, job] of detectedUrlJobs.entries()) {
    if (isExpired(job.createdAt)) {
      detectedUrlJobs.delete(jobId);
    }
  }

  for (const [jobId, job] of bookUnderstandingJobs.entries()) {
    if (isExpired(job.createdAt)) {
      bookUnderstandingJobs.delete(jobId);
      if (enrichmentWaitByUser.get(job.userId) === jobId) {
        enrichmentWaitByUser.delete(job.userId);
      }
    }
  }
}

export function saveDetectedProductUrlJob(input: { userId: number; alias: string }): ProductSeoDetectedUrlJob {
  pruneExpiredJobs();
  const job: ProductSeoDetectedUrlJob = {
    type: "product_seo_detected_url",
    jobId: randomUUID(),
    userId: input.userId,
    alias: input.alias,
    createdAt: Date.now()
  };
  detectedUrlJobs.set(job.jobId, job);
  return job;
}

export function getDetectedProductUrlJob(jobId: string, userId: number): ProductSeoDetectedUrlJob | null {
  pruneExpiredJobs();
  const job = detectedUrlJobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export function deleteDetectedProductUrlJob(jobId: string): void {
  detectedUrlJobs.delete(jobId);
}

export function saveProductSeoPendingJob(job: ProductSeoPendingJob): void {
  pruneExpiredJobs();
  pendingUpdateJobs.set(job.jobId, job);
}

export function getProductSeoPendingJob(jobId: string, userId: number): ProductSeoPendingJob | null {
  pruneExpiredJobs();
  const job = pendingUpdateJobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export function deleteProductSeoPendingJob(jobId: string): void {
  pendingUpdateJobs.delete(jobId);
}

export function saveProductSeoBookUnderstandingJob(job: ProductSeoBookUnderstandingJob): void {
  pruneExpiredJobs();
  bookUnderstandingJobs.set(job.jobId, job);
}

export function getProductSeoBookUnderstandingJob(jobId: string, userId: number): ProductSeoBookUnderstandingJob | null {
  pruneExpiredJobs();
  const job = bookUnderstandingJobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export function deleteProductSeoBookUnderstandingJob(jobId: string): void {
  const job = bookUnderstandingJobs.get(jobId);
  bookUnderstandingJobs.delete(jobId);
  if (job && enrichmentWaitByUser.get(job.userId) === jobId) {
    enrichmentWaitByUser.delete(job.userId);
  }
}

export function setProductSeoEnrichmentWait(userId: number, jobId: string): void {
  pruneExpiredJobs();
  enrichmentWaitByUser.set(userId, jobId);
}

export function getProductSeoEnrichmentWait(userId: number): ProductSeoBookUnderstandingJob | null {
  pruneExpiredJobs();
  const jobId = enrichmentWaitByUser.get(userId);
  if (!jobId) {
    return null;
  }

  const job = bookUnderstandingJobs.get(jobId);
  if (!job || job.userId !== userId) {
    enrichmentWaitByUser.delete(userId);
    return null;
  }

  return job;
}

export function clearProductSeoEnrichmentWait(userId: number): void {
  enrichmentWaitByUser.delete(userId);
}
