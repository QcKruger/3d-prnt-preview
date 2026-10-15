import * as React from "react";
import type { EnquiryFields, EnquiryErrors, Notify } from "../types";
import { FieldLabel, MobileDisclosure } from "../components/Layout";
export function useModelFile(notify: Notify) {
  const [file, setFile] = React.useState<File | null>(null);
  const [error, setError] = React.useState("");
  const [dragging, setDragging] = React.useState(false);
  function chooseFile(selected?: File) {
    setDragging(false);
    if (!selected) return;
    if (!/\.(stl|obj|3mf)$/i.test(selected.name)) {
      setError("Please choose an STL, OBJ or 3MF file.");
      return;
    }
    if (selected.size === 0) {
      setError("This file is empty. Please choose a model containing data.");
      return;
    }
    setFile(selected);
    setError("");
    notify("Model selected — kept on your device");
  }
  return {
    file,
    error,
    dragging,
    setDragging,
    chooseFile,
  };
}
export function validateEnquiry(fields: EnquiryFields): EnquiryErrors {
  const errors: EnquiryErrors = {};
  if (!fields.name.trim()) errors.name = "Please enter your name.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim()))
    errors.email = "Please enter a valid email address.";
  if (fields.description.trim().length < 10)
    errors.description =
      "Tell us a little more about your idea (at least 10 characters).";
  if (
    !/^\d+$/.test(fields.quantity) ||
    Number(fields.quantity) < 1 ||
    Number(fields.quantity) > 1000
  )
    errors.quantity = "Choose a quantity between 1 and 1,000.";
  return errors;
}
export const initialEnquiry = {
  name: "",
  email: "",
  description: "",
  quantity: "1",
  colour: "",
  dimensions: "",
};
export function useEnquiry(file: File | null, fileError: string) {
  const [fields, setFields] = React.useState<EnquiryFields>(initialEnquiry);
  const [errors, setErrors] = React.useState<EnquiryErrors>({});
  const [saved, setSaved] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);
  function change(field: keyof EnquiryFields, value: string) {
    setFields((previous) => ({
      ...previous,
      [field]: value,
    }));
    setErrors((previous) => ({
      ...previous,
      [field]: undefined,
    }));
    setSaved(false);
  }
  function downloadBrief() {
    const validation = validateEnquiry(fields);
    setErrors(validation);
    if (Object.keys(validation).length || fileError) {
      const firstField = Object.keys(validation)[0];
      formRef.current
        ?.querySelector<HTMLElement>(
          firstField ? '[name="' + firstField + '"]' : "#file",
        )
        ?.focus();
      return;
    }
    const brief = [
      "3D PRNT — Custom print enquiry",
      "",
      "Name: " + fields.name.trim(),
      "Email: " + fields.email.trim(),
      "Quantity: " + fields.quantity,
      "Preferred colour: " + (fields.colour || "Advice requested"),
      "Dimensions: " + (fields.dimensions || "To be confirmed"),
      "Model filename: " + (file?.name || "No model yet"),
      "",
      "Idea:",
      fields.description.trim(),
      "",
      "This brief has not been sent. Keep your model file separately; it is not included in this text download.",
      "",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([brief], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "3d-prnt-enquiry.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  }
  return {
    fields,
    errors,
    saved,
    formRef,
    change,
    downloadBrief,
  };
}
export function EnquiryForm({ notify }: { notify: Notify }) {
  let model = useModelFile(notify);
  let enquiry = useEnquiry(model.file, model.error);
  let renderField = (
    field: keyof EnquiryFields,
    label: string,
    type: React.HTMLInputTypeAttribute = "text",
    placeholder = "",
  ) => (
    <div className="form-field">
      <FieldLabel htmlFor={`quote-${field}`}>{label}</FieldLabel>
      <input
        id={`quote-${field}`}
        name={field}
        type={type}
        placeholder={placeholder}
        value={enquiry.fields[field]}
        min={field === "quantity" ? 1 : void 0}
        max={field === "quantity" ? 1e3 : void 0}
        step={field === "quantity" ? 1 : void 0}
        autoComplete={
          field === "name" ? "name" : field === "email" ? "email" : void 0
        }
        onChange={(t) => enquiry.change(field, t.target.value)}
        aria-invalid={!!enquiry.errors[field]}
        aria-describedby={enquiry.errors[field] ? `error-${field}` : void 0}
      />
      {enquiry.errors[field] && (
        <span className="field-error" id={`error-${field}`}>
          {enquiry.errors[field]}
        </span>
      )}
    </div>
  );
  return (
    <form
      className="quote-form"
      ref={enquiry.formRef}
      noValidate={true}
      onSubmit={(e) => {
        e.preventDefault();
        enquiry.downloadBrief();
      }}
    >
      <div className="form-heading">
        <h3>Tell us what you have in mind</h3>
        <p>No model yet? A description is a good place to start.</p>
      </div>
      <div className="form-grid">
        {renderField("name", "Your name *")}
        {renderField("email", "Email address *", "email")}
        {renderField("quantity", "Quantity *", "number")}
        {renderField("colour", "Preferred colour", "text", "e.g. matte black")}
        {renderField(
          "dimensions",
          "Approximate dimensions",
          "text",
          "e.g. 120 × 80 × 40 mm",
        )}
      </div>
      <div className="form-field">
        <FieldLabel htmlFor="quote-description">
          Your idea or requirements *
        </FieldLabel>
        <textarea
          id="quote-description"
          name="description"
          rows={4}
          placeholder="What would you like to print, and how will it be used?"
          value={enquiry.fields.description}
          onChange={(e) => enquiry.change("description", e.target.value)}
          aria-invalid={!!enquiry.errors.description}
          aria-describedby={
            enquiry.errors.description ? "error-description" : void 0
          }
        />
        {enquiry.errors.description && (
          <span id="error-description" className="field-error">
            {enquiry.errors.description}
          </span>
        )}
      </div>
      <div
        className={`model-upload${model.dragging ? " dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          model.setDragging(true);
        }}
        onDragLeave={() => model.setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          model.chooseFile(e.dataTransfer.files[0]);
        }}
      >
        <FieldLabel htmlFor="file">
          {"Attach a model "}
          <span>(optional)</span>
        </FieldLabel>
        <input
          id="file"
          type="file"
          accept=".stl,.obj,.3mf"
          aria-describedby="model-help"
          aria-invalid={!!model.error}
          onChange={(e) => model.chooseFile(e.target.files?.[0])}
        />
        <p id="model-help">
          {model.file?.name ||
            "Choose or drop an STL, OBJ or 3MF file. Kept on your device."}
        </p>
        {model.error && (
          <p className="field-error" role="alert">
            {model.error}
          </p>
        )}
      </div>
      <button className="btn primary" type="submit">
        SAVE ENQUIRY BRIEF ↓
      </button>
      <p className="form-note">
        Our contact channels are being set up. For now, download your brief to
        keep it ready. Nothing is submitted or uploaded.
      </p>
      {enquiry.saved && (
        <div className="form-success" role="status">
          Your brief is ready to download. Keep the model file separately. No
          enquiry has been sent.
        </div>
      )}
    </form>
  );
}
export function CustomPrints({ notify }: { notify: Notify }) {
  return (
    <section className="section custom" id="custom">
      <div className="container custom-grid">
        <div className="custom-intro reveal">
          <div className="eyebrow">MADE AROUND YOUR IDEA</div>
          <h2>
            Something personal.
            <br />
            <span className="gradient">Something yours.</span>
          </h2>
          <p className="section-desc">
            A personalised gift, a useful replacement part or the first version
            of your next big idea. Tell us what you have in mind.
          </p>
          <div className="enquiry-steps">
            <div>
              <span>01</span>
              <p>
                <b>Share your idea</b>
                <br />
                Start with a model file or a simple description.
              </p>
            </div>
            <div>
              <span>02</span>
              <p>
                <b>Refine the details</b>
                <br />
                Size, material and colour shape the final quote.
              </p>
            </div>
            <div>
              <span>03</span>
              <p>
                <b>Approve before printing</b>
                <br />
                Pricing and timing are confirmed before production.
              </p>
            </div>
          </div>
          <div className="contact-note">
            Contact details coming soon. You can prepare and save your enquiry
            here today.
          </div>
        </div>
        <MobileDisclosure title="Prepare a custom print enquiry">
          <EnquiryForm notify={notify} />
        </MobileDisclosure>
      </div>
    </section>
  );
}
