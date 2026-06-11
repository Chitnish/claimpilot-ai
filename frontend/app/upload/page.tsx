"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import { FileUp, Loader2, Upload } from "lucide-react";

import { uploadClaim } from "@/lib/api";
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (!file) return;

      setUploading(true);
      setError(null);

      try {
        const result = await uploadClaim(file, demoMode);
        router.push(`/claims/${result.claim_id}`);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Upload failed. Please try again.";
        setError(message);
        setUploading(false);
      }
    },
    [router, demoMode],
  );

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0]?.errors[0]?.message;
    setError(first ?? "Only PDF, PNG, and JPG files are accepted.");
  }, []);

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    onDropRejected,
    accept: ACCEPTED_TYPES,
    maxFiles: 1,
    disabled: uploading,
    noClick: true,
  });

  return (
    <div className="flex min-h-full items-center justify-center p-8">
      <Card className="w-full max-w-lg border-[#1e3a5f]/20 shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-[#1e3a5f] text-white">
            <Upload className="size-6" />
          </div>
          <CardTitle className="text-[#1e3a5f]">Upload Superbill</CardTitle>
          <CardDescription>
            Drop a superbill PDF or image to start the ClaimPilot AI pipeline.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
                  Uploading and starting pipeline…
                </p>
              </>
            ) : (
              <>
                <FileUp className="mb-3 size-10 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {isDragActive
                    ? "Drop the file here"
                    : "Drag & drop a file here, or click to browse"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  PDF, PNG, or JPG
                </p>
              </>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Demo Mode</p>
              <p className="text-xs text-muted-foreground">
                Forces denial + appeal letter for guaranteed golden-path demo
              </p>
            </div>
            <button
              role="switch"
              aria-checked={demoMode}
              onClick={() => setDemoMode((v) => !v)}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                demoMode ? "bg-[#1e3a5f]" : "bg-gray-200",
              )}
            >
              <span
                className={cn(
                  "inline-block size-4 rounded-full bg-white shadow transition-transform",
                  demoMode ? "translate-x-6" : "translate-x-1",
                )}
              />
            </button>
          </div>

          {error && (
            <p className="mt-4 text-center text-sm text-destructive">{error}</p>
          )}

          {!uploading && (
            <div className="mt-4 flex justify-center">
              <Button
                type="button"
                className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                onClick={open}
              >
                Select file
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
