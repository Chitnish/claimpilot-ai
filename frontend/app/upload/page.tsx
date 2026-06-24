"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  CheckCircle2,
  CloudUpload,
  FileText,
  Loader2,
  X,
} from "lucide-react";

import { uploadClaim, uploadClaimBatch } from "@/lib/api";
import type { BatchUploadItem } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ACCEPTED_TYPES = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
} as const;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function UploadPage(): React.ReactElement {
  const router = useRouter();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchUploadItem[] | null>(
    null,
  );

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setError(null);
    setBatchResult(null);
    setSelectedFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}-${f.size}`));
      const merged = [...prev];
      for (const file of acceptedFiles) {
        const key = `${file.name}-${file.size}`;
        if (!existing.has(key)) {
          merged.push(file);
          existing.add(key);
        }
      }
      return merged;
    });
  }, []);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0]?.errors[0]?.message;
    setError(first ?? "Only PDF, PNG, and JPG files are accepted.");
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    setError(null);
  }, []);

  const handleUploadAll = useCallback(async () => {
    if (selectedFiles.length === 0) return;

    setUploading(true);
    setError(null);
    setBatchResult(null);

    try {
      if (selectedFiles.length === 1) {
        const result = await uploadClaim(selectedFiles[0]!);
        router.push(`/claims/${result.claim_id}`);
        return;
      }

      const result = await uploadClaimBatch(selectedFiles);
      setBatchResult(result.claims);
      setSelectedFiles([]);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setError(message);
    } finally {
      setUploading(false);
    }
  }, [router, selectedFiles]);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_TYPES,
    disabled: uploading || batchResult !== null,
    noClick: true,
  });

  const fileCount = selectedFiles.length;

  return (
    <div className="flex min-h-full items-center justify-center p-6 lg:p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-dark text-white shadow-md shadow-brand/20">
            <CloudUpload className="size-6" />
          </div>
          <CardTitle className="text-slate-900">Upload Superbills</CardTitle>
          <CardDescription>
            Each superbill becomes a separate claim, processed in parallel
            through the pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {batchResult ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8">
                <CheckCircle2 className="mb-3 size-10 text-emerald-600" />
                <p className="text-center text-sm font-medium text-emerald-900">
                  {batchResult.length} claims uploaded and processing.
                </p>
                <p className="mt-1 text-center text-xs text-emerald-700">
                  Open each claim below to watch live agent activity.
                </p>
              </div>
              <ul className="space-y-2">
                {batchResult.map((item) => (
                  <li key={item.claimId}>
                    <Link
                      href={`/claims/${item.claimId}`}
                      className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-brand/40 hover:bg-sky-50"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <FileText className="size-4 shrink-0 text-slate-400" />
                        <span className="truncate font-medium text-slate-800">
                          {item.filename}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-xs text-slate-500">
                        {item.claimId.slice(0, 8)}…
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex justify-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setBatchResult(null)}
                >
                  Upload more
                </Button>
                <Button
                  type="button"
                  className="bg-brand text-white hover:bg-brand-dark"
                  asChild
                >
                  <Link href="/dashboard">Go to dashboard</Link>
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div
                {...getRootProps()}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors",
                  isDragActive
                    ? "border-solid border-brand bg-blue-50"
                    : "border-brand/40 hover:border-brand/70 hover:bg-slate-50",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                <input {...getInputProps()} />
                {uploading ? (
                  <>
                    <Loader2 className="mb-3 size-12 animate-spin text-brand" />
                    <p className="text-sm font-medium text-slate-700">
                      Uploading and starting pipelines…
                    </p>
                  </>
                ) : (
                  <>
                    <CloudUpload
                      className={cn(
                        "mb-3 size-12 transition-colors",
                        isDragActive ? "text-brand" : "text-slate-400",
                      )}
                    />
                    <p className="text-base font-semibold text-slate-900">
                      {isDragActive ? "Drop to upload" : "Drop superbills here"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      PDF or image files — upload multiple at once for batch
                      processing
                    </p>
                  </>
                )}
              </div>

              {fileCount > 0 && !uploading && (
                <ul className="mt-4 space-y-2">
                  {selectedFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm">
                        <FileText className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">
                          {file.name}
                        </span>
                        <span className="text-xs text-slate-500">
                          {formatFileSize(file.size)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="shrink-0 rounded p-1 text-slate-400 transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {error && (
                <p className="mt-4 text-center text-sm text-destructive">
                  {error}
                </p>
              )}

              {!uploading && (
                <div className="mt-5 flex flex-col items-center gap-3">
                  {fileCount > 0 && (
                    <Badge
                      variant="outline"
                      className="border-sky-200 bg-sky-50 text-brand-dark"
                    >
                      {fileCount} {fileCount === 1 ? "file" : "files"} selected
                    </Badge>
                  )}
                  <div className="flex w-full flex-col-reverse gap-3 sm:w-auto sm:flex-row sm:justify-center">
                    <Button type="button" variant="outline" onClick={open}>
                      {fileCount > 0 ? "Add more files" : "Select files"}
                    </Button>
                    {fileCount > 0 && (
                      <Button
                        type="button"
                        size="lg"
                        className="w-full bg-brand text-white hover:bg-brand-dark sm:w-auto"
                        onClick={handleUploadAll}
                      >
                        <CloudUpload className="size-4" />
                        Upload {fileCount === 1 ? "file" : `all ${fileCount}`}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
