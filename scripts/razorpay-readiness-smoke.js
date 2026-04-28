const projectId = process.env.GCLOUD_PROJECT || "parichayam-9ee09";
const functionUrl = `http://127.0.0.1:5001/${projectId}/us-central1/submitContactForm`;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
const firestoreUrl = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/complaints`;

async function main() {
  const payload = {
    name: "Razorpay Readiness Test",
    email: "support@parichayam.co.im",
    phone: "9440176078",
    category: "general",
    message: "Smoke test submission for Razorpay launch readiness contact form.",
  };

  const response = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5000",
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok !== true || !body.complaintId) {
    throw new Error(`submitContactForm failed: ${response.status} ${JSON.stringify(body)}`);
  }

  const listResponse = await fetch(firestoreUrl);
  const listBody = await listResponse.json().catch(() => ({}));
  const docs = Array.isArray(listBody.documents) ? listBody.documents : [];
  const found = docs.some((doc) => String(doc.name || "").endsWith(`/complaints/${body.complaintId}`));
  if (!found) {
    throw new Error(`Complaint ${body.complaintId} was not found in Firestore emulator.`);
  }

  console.log(JSON.stringify({
    ok: true,
    complaintId: body.complaintId,
    storedComplaints: docs.length,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
