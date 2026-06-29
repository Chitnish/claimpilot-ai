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
import { Reveal } from "@/components/ui/motion";
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
      <Reveal className="w-full max-w-2xl">
      <Card className="relative overflow-hidden">
        <span className="accent-glow -right-10 -top-10 size-40 bg-brand/30" aria-hidden />
        <CardHeader className="relative text-center">
          <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-brand-dark text-white shadow-lg shadow-brand/30 ring-1 ring-white/30">
            <CloudUpload className="size-7" />
          </div>
          <CardTitle className="font-display text-xl text-slate-900">
            Upload Superbills
          </CardTitle>
          <CardDescription>
            Each superbill becomes a separate claim, processed in parallel
            through the pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent className="relative">
          {batchResult ? (
            <div className="space-y-4">
              <div className="flex flex-col items-center rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50 to-white px-6 py-8">
                <div className="mb-3 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/30 ring-1 ring-white/30">
                  <CheckCircle2 className="size-7" />
                </div>
                <p className="text-center font-display text-base font-semibold text-emerald-900">
                  {batchResult.length} claims uploaded and processing
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
                      className="group flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 text-sm shadow-sm transition-colors hover:border-brand/40 hover:bg-sky-50"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors group-hover:bg-white group-hover:text-brand">
                          <FileText className="size-4" />
                        </span>
                        <span className="truncate font-medium text-slate-800">
                          {item.filename}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-500">
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
                  "group relative flex cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-all duration-200",
                  isDragActive
                    ? "scale-[1.01] border-solid border-brand bg-brand/[0.06] ring-4 ring-brand/15"
                    : "border-slate-300 hover:border-brand/60 hover:bg-slate-50",
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
                    <div
                      className={cn(
                        "mb-4 flex size-16 items-center justify-center rounded-2xl transition-all duration-200",
                        isDragActive
                          ? "bg-gradient-to-br from-brand to-brand-dark text-white shadow-lg shadow-brand/30 ring-1 ring-white/30"
                          : "bg-slate-100 text-slate-400 ring-1 ring-slate-200 group-hover:bg-sky-50 group-hover:text-brand",
                      )}
                    >
                      <CloudUpload className="size-8" />
                    </div>
                    <p className="font-display text-base font-semibold text-slate-900">
                      {isDragActive
                        ? "Drop to upload"
                        : "Drop superbills here"}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      or{" "}
                      <span className="font-medium text-brand">
                        browse files
                      </span>{" "}
                      — upload multiple at once for batch processing
                    </p>
                    <div className="mt-4 flex items-center gap-2">
                      {["PDF", "PNG", "JPG"].map((fmt) => (
                        <span
                          key={fmt}
                          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500"
                        >
                          {fmt}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {fileCount > 0 && !uploading && (
                <ul className="mt-4 space-y-2">
                  {selectedFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm transition-colors hover:border-brand/30"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
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
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-destructive/10 hover:text-destructive"
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
      </Reveal>
    </div>
  );
}
