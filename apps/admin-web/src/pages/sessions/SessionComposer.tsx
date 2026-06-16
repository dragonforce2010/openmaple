import { useRef, useState } from "react";
import { apiUpload } from "../../api";
import { useI18n } from "../../appConfig";
import { Icon } from "../../ui";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

type Attachment = { fileId: string; filename: string };

// The composer owns file upload: a picked file is uploaded to the session immediately (the backend
// stores it in TOS and links it to the session), so by the time the user hits send the agent will
// see it via the injected file manifest. Sending stays plain text.
export function SessionComposer(props: {
  sessionId: string;
  message: string;
  setMessage: (value: string) => void;
  sendMessage: () => void;
  sending: boolean;
  placeholder: string;
}) {
  const { language } = useI18n();
  const L = (zh: string, en: string) => (language === "zh" ? zh : en);
  const fileInput = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const disabled = props.sending || !props.sessionId;

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !props.sessionId) return;
    setError("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_UPLOAD_BYTES) throw new Error(L(`文件 ${file.name} 超过 50MB 上限`, `${file.name} exceeds the 50MB limit`));
        const form = new FormData();
        form.append("file", file);
        const result = await apiUpload<{ id: string; filename: string }>(`/v1/sessions/${props.sessionId}/files`, form);
        setAttachments((current) => [...current, { fileId: result.id, filename: result.filename }]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function send() {
    props.sendMessage();
    setAttachments([]);
  }

  return (
    <div className="composer-wrap">
      {attachments.length ? (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <span key={attachment.fileId} className="attachment-chip">
              <Icon name="i-file" size={13} />
              <span className="attachment-name">{attachment.filename}</span>
              <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item.fileId !== attachment.fileId))} aria-label={L("移除", "Remove")}>
                <Icon name="i-x" size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {error ? <div className="composer-error">{error}</div> : null}
      <div className="composer">
        <input
          type="file"
          ref={fileInput}
          multiple
          style={{ display: "none" }}
          onChange={(event) => uploadFiles(event.target.files)}
        />
        <button
          className="attach-btn"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || uploading}
          title={L("上传文件", "Upload file")}
        >
          <Icon name={uploading ? "i-refresh" : "i-upload"} size={16} />
        </button>
        <input
          value={props.message}
          onChange={(event) => props.setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (!props.sending) send();
            }
          }}
          placeholder={props.placeholder}
        />
        <button className="send-btn" onClick={send} disabled={disabled}>
          <Icon name="i-send" size={16} />
        </button>
      </div>
    </div>
  );
}
