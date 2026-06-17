"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { CheckCircle2, Files, FileUp, Loader2, Upload, X } from "lucide-react";

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
  const showMultiIcon = fileCount > 1;

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <Card className="w-full max-w-lg border-[#1e3a5f]/20 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[#1e3a5f] text-white">
            {showMultiIcon ? (
              <Files className="size-6" />
            ) : (
              <Upload className="size-6" />
            )}
          </div>
          <CardTitle className="text-[#1e3a5f]">Upload Superbill</CardTitle>
          <CardDescription>
            You can upload multiple superbills at once — each becomes a separate
            claim processed in parallel.
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
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors hover:border-[#1e3a5f]/40 hover:bg-[#1e3a5f]/5"
                    >
                      <span className="truncate font-medium text-[#1e3a5f]">
                        {item.filename}
                      </span>
                      <span className="ml-2 shrink-0 font-mono text-xs text-muted-foreground">
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
                  className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
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
                  "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 transition-colors",
                  isDragActive
                    ? "border-[#1e3a5f] bg-[#1e3a5f]/5"
                    : "border-muted-foreground/25 hover:border-[#1e3a5f]/50 hover:bg-muted/30",
                  uploading && "pointer-events-none opacity-60",
                )}
              >
                <input {...getInputProps()} />
                {uploading ? (
                  <>
                    <Loader2 className="mb-3 size-10 animate-spin text-[#1e3a5f]" />
                    <p className="text-sm font-medium text-[#1e3a5f]">
                      Uploading and starting pipelines…
                    </p>
                  </>
                ) : (
                  <>
                    {showMultiIcon ? (
                      <Files className="mb-3 size-10 text-[#1e3a5f]" />
                    ) : (
                      <FileUp className="mb-3 size-10 text-muted-foreground" />
                    )}
                    <p className="text-sm font-medium">
                      {isDragActive
                        ? "Drop files here"
                        : "Drag & drop files here, or click to browse"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      PDF, PNG, or JPG
                    </p>
                    {fileCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="mt-3 border-[#1e3a5f]/20 bg-[#1e3a5f]/10 text-[#1e3a5f]"
                      >
                        {fileCount} {fileCount === 1 ? "file" : "files"}{" "}
                        selected
                      </Badge>
                    )}
                  </>
                )}
              </div>

              {fileCount > 0 && !uploading && (
                <ul className="mt-4 space-y-2">
                  {selectedFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${file.size}-${index}`}
                      className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-medium">{file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="ml-2 shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
                <div className="mt-4 flex justify-center gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={open}
                  >
                    {fileCount > 0 ? "Add more files" : "Select files"}
                  </Button>
                  {fileCount > 0 && (
                    <Button
                      type="button"
                      className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                      onClick={handleUploadAll}
                    >
                      Upload {fileCount === 1 ? "file" : "all"}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
