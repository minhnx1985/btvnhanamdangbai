import { randomUUID } from "node:crypto";
import {
  ProductSeoBookUnderstandingJob,
  ProductSeoPendingJob,
  ProductSeoPreparationJob
} from "../types/product-seo.types";

const PRODUCT_SEO_JOB_TTL_MS = 30 * 60 * 1000;
const pendingUpdateJobs = new Map<string, ProductSeoPendingJob>();
const bookUnderstandingJobs = new Map<string, ProductSeoBookUnderstandingJob>();
const preparationJobs = new Map<string, ProductSeoPreparationJob>();
const enrichmentWaitByUser = new Map<number, string>();
const preparationWaitByUser = new Map<number, string>();
const formatDescriptionWaitByUser = new Map<number, string>();

function isExpired(createdAt: number): boolean {
  return Date.now() - createdAt > PRODUCT_SEO_JOB_TTL_MS;
}

function pruneExpiredJobs(): void {
  for (const [jobId, job] of pendingUpdateJobs.entries()) {
    if (isExpired(job.createdAt)) {
      pendingUpdateJobs.delete(jobId);
    }
  }

  for (const [jobId, job] of preparationJobs.entries()) {
    if (isExpired(job.createdAt)) {
      preparationJobs.delete(jobId);
      if (preparationWaitByUser.get(job.userId) === jobId) {
        preparationWaitByUser.delete(job.userId);
      }
      if (formatDescriptionWaitByUser.get(job.userId) === jobId) {
        formatDescriptionWaitByUser.delete(job.userId);
      }
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

export function saveDetectedProductUrlJob(input: { userId: number; alias: string }): ProductSeoPreparationJob {
  pruneExpiredJobs();
  const job: ProductSeoPreparationJob = {
    type: "product_seo_preparation",
    jobId: randomUUID(),
    userId: input.userId,
    alias: input.alias,
    createdAt: Date.now()
  };
  preparationJobs.set(job.jobId, job);
  return job;
}

export function getDetectedProductUrlJob(jobId: string, userId: number): ProductSeoPreparationJob | null {
  pruneExpiredJobs();
  const job = preparationJobs.get(jobId);
  if (!job || job.userId !== userId) {
    return null;
  }

  return job;
}

export function deleteDetectedProductUrlJob(jobId: string): void {
  const job = preparationJobs.get(jobId);
  preparationJobs.delete(jobId);
  if (job && preparationWaitByUser.get(job.userId) === jobId) {
    preparationWaitByUser.delete(job.userId);
  }
  if (job && formatDescriptionWaitByUser.get(job.userId) === jobId) {
    formatDescriptionWaitByUser.delete(job.userId);
  }
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

export function setProductSeoPreparationWait(userId: number, jobId: string): void {
  pruneExpiredJobs();
  preparationWaitByUser.set(userId, jobId);
}

export function setProductSeoFormatDescriptionWait(userId: number, jobId: string): void {
  pruneExpiredJobs();
  formatDescriptionWaitByUser.set(userId, jobId);
}

export function getProductSeoPreparationWait(userId: number): ProductSeoPreparationJob | null {
  pruneExpiredJobs();
  const jobId = preparationWaitByUser.get(userId);
  if (!jobId) {
    return null;
  }

  const job = preparationJobs.get(jobId);
  if (!job || job.userId !== userId) {
    preparationWaitByUser.delete(userId);
    return null;
  }

  return job;
}

export function getProductSeoFormatDescriptionWait(userId: number): ProductSeoPreparationJob | null {
  pruneExpiredJobs();
  const jobId = formatDescriptionWaitByUser.get(userId);
  if (!jobId) {
    return null;
  }

  const job = preparationJobs.get(jobId);
  if (!job || job.userId !== userId) {
    formatDescriptionWaitByUser.delete(userId);
    return null;
  }

  return job;
}

export function clearProductSeoPreparationWait(userId: number): void {
  preparationWaitByUser.delete(userId);
}

export function clearProductSeoFormatDescriptionWait(userId: number): void {
  formatDescriptionWaitByUser.delete(userId);
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
