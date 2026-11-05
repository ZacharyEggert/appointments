import { CONTACT_EMAIL, LEGAL_ENTITY, LegalPage } from "../legal-page";

export const meta = () => [{ title: "Terms of Service · Appointments" }];

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      <p>
        These terms govern use of Appointments (the "App"), a Shopify app operated by {LEGAL_ENTITY} ("we", "us").
        By installing or using the App, you agree to them.
      </p>

      <h2>The service</h2>
      <p>
        The App lets Shopify merchants offer bookable Services on their storefront. Availability comes from the
        merchant's connected Google Calendar, and Bookings are recorded as events on that calendar. The App is
        currently provided free of charge. It does not take payments; any Price note is for information only.
      </p>

      <h2>Merchant responsibilities</h2>
      <ul>
        <li>Keep your Shopify and Google accounts secure, and keep Google connected for bookings to work.</li>
        <li>Your Opening hours, Services, and calendar are accurate, and you honour the Bookings customers make.</li>
        <li>
          You are responsible for your relationship with your customers, including your own privacy notice,
          cancellation terms, and compliance with laws that apply to your business.
        </li>
        <li>Do not use the App for unlawful, abusive, or spam purposes.</li>
      </ul>

      <h2>Customer bookings</h2>
      <p>
        Customers who book through a merchant's storefront enter into an arrangement with that merchant, not with
        us. Questions about a Booking should go to the merchant.
      </p>

      <h2>Third-party services</h2>
      <p>
        The App depends on Shopify and Google Calendar. Their own terms apply to your use of them, and we are not
        responsible for their availability or behaviour, including delivery of calendar invitations.
      </p>

      <h2>Data</h2>
      <p>
        Our handling of personal data is described in the <a href="/privacy">Privacy Policy</a>. Bookings live in
        your Google Calendar and remain yours.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We aim to keep the App running but do not guarantee it will be uninterrupted or error-free. We may change,
        suspend, or discontinue the App or these terms; material changes will be posted on this page with an
        updated date.
      </p>

      <h2>Disclaimer and limitation of liability</h2>
      <p>
        The App is provided "as is" and "as available" without warranties of any kind, to the fullest extent
        permitted by law. To the fullest extent permitted by law, {LEGAL_ENTITY} is not liable for indirect,
        incidental, special, or consequential damages, or for lost bookings, revenue, or data, arising from use of
        the App. Our total liability for any claim relating to the App is limited to the amount you paid us for
        the App in the 12 months before the claim (currently zero) or USD 100, whichever is greater.
      </p>

      <h2>Termination</h2>
      <p>
        You can stop using the App at any time by uninstalling it. We may suspend access for misuse. On
        uninstall, data is handled as described in the Privacy Policy.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of the State of Washington, USA.</p>

      <h2>Contact</h2>
      <p>
        {LEGAL_ENTITY} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
