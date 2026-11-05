import { CONTACT_EMAIL, LEGAL_ENTITY, LegalPage } from "../legal-page";

export const meta = () => [{ title: "Privacy Policy · Appointments" }];

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Appointments (the "App") is a Shopify app operated by {LEGAL_ENTITY} ("we", "us"). It lets Shopify
        merchants offer bookable Services on their storefront, using the merchant's own Google Calendar to
        check availability and record Bookings. This policy explains what data the App handles and why.
      </p>

      <h2>Who this covers</h2>
      <ul>
        <li><strong>Merchants</strong>: Shopify store owners and staff who install the App.</li>
        <li><strong>Customers</strong>: people who book a Service through a merchant's storefront.</li>
      </ul>

      <h2>Data we collect and store</h2>
      <h3>From merchants</h3>
      <ul>
        <li>Shopify store domain and the Shopify access token needed to run the App.</li>
        <li>
          Google OAuth tokens for the one Google account the merchant connects. Tokens are encrypted at rest.
        </li>
        <li>The ID and time zone of the Google calendar the merchant selects, Opening hours, and default Slot rules.</li>
      </ul>
      <p>
        Service definitions (name, duration, Price note, etc.) are stored in the merchant's own Shopify store as
        metaobjects, not in our database.
      </p>

      <h3>From customers</h3>
      <p>
        When a customer books, they provide a name, email address, and optionally a phone number and notes. If
        they are logged in to the store, Shopify tells us their customer ID. We do <strong>not</strong> keep a copy of
        Bookings in our database. The Booking details are written directly as an event on the merchant's Google
        Calendar, with the customer added as an attendee. The event also stores the store domain, Service ID,
        product ID (if booked from a product page), Shopify customer ID (if logged in), and a one-way SHA-256 hash of
        the customer's email address, so Bookings can be found later for cancellation and privacy requests.
      </p>
      <p>
        To prevent spam, we keep short-lived counters keyed by a hash of the requester's IP address and a hash of
        their email address. These expire after 15 minutes.
      </p>

      <h2>Google user data</h2>
      <p>The App requests these Google Calendar permissions from the merchant:</p>
      <ul>
        <li><code>calendar.freebusy</code>: read busy/free times so only open Slots are offered. Event details are not read.</li>
        <li><code>calendar.events</code>: create, update, read, and delete the Booking events the App makes, and list them in the admin Bookings page.</li>
        <li><code>calendar.calendarlist.readonly</code>: list the merchant's calendars so they can choose one.</li>
      </ul>
      <p>
        We use Google user data only to provide these booking features to the merchant who granted access. We do
        not sell it, use it for advertising, use it to train AI or machine-learning models, or let humans read it,
        except with the merchant's consent for support, for security purposes, or to comply with law.
      </p>
      <p>
        The App's use and transfer of information received from Google APIs adheres to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>

      <h2>How data is shared</h2>
      <ul>
        <li><strong>Google</strong>: Booking events are stored in the merchant's Google Calendar, and Google sends calendar invitations and cancellation emails to customers.</li>
        <li><strong>Shopify</strong>: the App runs inside Shopify and reads products and the merchant's Service metaobjects.</li>
        <li><strong>Railway</strong>: our hosting and database provider, which processes data on our behalf.</li>
      </ul>
      <p>We do not sell personal data or share it with anyone else, except where required by law.</p>

      <h2>Retention and deletion</h2>
      <ul>
        <li>
          When a merchant uninstalls the App, we revoke our Google access and delete the store's data from our
          database. Events already on the merchant's Google Calendar stay there, under the merchant's control.
        </li>
        <li>
          When Shopify sends us a customer redaction request, we remove that customer's personal details from
          matching Booking events (name, contact details, notes, attendee entry, and stored identifiers) while
          keeping the time blocked on the calendar. If the merchant has disconnected Google or uninstalled the
          App, we can no longer reach those events; the merchant can delete them directly in Google Calendar.
        </li>
        <li>Merchants can disconnect Google at any time from their Google Account permissions page.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS. Google tokens are encrypted at rest. Storefront requests are verified with
        Shopify's signatures, and Manage links for cancelling a Booking are cryptographically signed.
      </p>

      <h2>Your rights</h2>
      <p>
        Customers should contact the merchant they booked with to access, correct, or delete their data;
        merchants can make these requests through Shopify, and we will act on them. You can also contact us
        directly at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>

      <h2>Changes</h2>
      <p>We will post any changes to this policy on this page and update the date above.</p>

      <h2>Contact</h2>
      <p>
        {LEGAL_ENTITY} · <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
      </p>
    </LegalPage>
  );
}
