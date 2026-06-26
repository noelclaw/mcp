async function test() {
  const key = "noel_sk_efc5a85942b5d483253351b8bdc76e92";
  console.log("Key:", key.slice(0,12));
  const res = await fetch("https://befitting-porcupine-276.convex.site/auth/apikey/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: ***  });
  console.log("Status:", res.status);
  const text = await res.text();
  console.log("Response:", text.slice(0,200));
}
test().catch(e => console.log("ERR:", e.message));
