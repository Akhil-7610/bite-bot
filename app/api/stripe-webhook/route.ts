// app/api/webhooks/route.ts

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma"; // <-- import Prisma client
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET as string;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature");

  let event: Stripe.Event;

  // Verify Stripe event is legit
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature || "",
      webhookSecret
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed. ${err.message}`);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }

  // Handle the event
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handleInvoicePaymentFailed(invoice);
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionDeleted(subscription);
        break;
      }
      // Add more event types as needed
      default:
        
    }
  } catch (error) {
    console.error('Error processing webhook:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({});
}

// Handler for successful checkout sessions
const handleCheckoutSessionCompleted = async (
  session: Stripe.Checkout.Session
) => {
  const userId = session.metadata?.clerkUserId;
  

  if (!userId) {
    console.error("No userId found in session metadata.");
    return;
  }

  // Retrieve subscription ID from the session
  const subscriptionId = session.subscription as string;

  if (!subscriptionId) {
    console.error("No subscription ID found in session.");
    return;
  }

  // Retrieve the subscription from Stripe to confirm it's active
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  // Update Prisma with subscription details
  try {
    const updatedProfile = await prisma.profile.update({
      where: { userId },
      data: {
        stripeSubscriptionId: subscriptionId,
        subscriptionActive: subscription.status === 'active',
        subscriptionTier: session.metadata?.planType || null,
      },
    });
   
  } catch (error: any) {
    console.error("Prisma Update Error:", error.message);
  }
};

// Handler for failed invoice payments
const handleInvoicePaymentFailed = async (invoice: Stripe.Invoice) => {
  const subscriptionId = invoice.subscription as string;
  

  if (!subscriptionId) {
    console.error("No subscription ID found in invoice.");
    return;
  }

  // Retrieve userId from subscription ID
  let userId: string | undefined;
  try {
    const profile = await prisma.profile.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { userId: true },
    });

    if (!profile?.userId) {
      console.error("No profile found for this subscription ID.");
      return;
    }

    userId = profile.userId;
  } catch (error: any) {
    console.error("Prisma Query Error:", error.message);
    return;
  }

  // Update Prisma with payment failure
  try {
    await prisma.profile.update({
      where: { userId },
      data: {
        subscriptionActive: false,
      },
    });
    
  } catch (error: any) {
    console.error("Prisma Update Error:", error.message);
  }
};

// Handler for subscription deletions (e.g., cancellations)
const handleSubscriptionDeleted = async (subscription: Stripe.Subscription) => {
  const subscriptionId = subscription.id;
  

  // Retrieve userId from subscription ID
  let userId: string | undefined;
  try {
    const profile = await prisma.profile.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      select: { userId: true },
    });

    if (!profile?.userId) {
      console.error("No profile found for this subscription ID.");
      return;
    }

    userId = profile.userId;
  } catch (error: any) {
    console.error("Prisma Query Error:", error.message);
    return;
  }

  // Update Prisma with subscription cancellation
  try {
    await prisma.profile.update({
      where: { userId },
      data: {
        subscriptionActive: false,
        stripeSubscriptionId: null,
      },
    });
    
  } catch (error: any) {
    console.error("Prisma Update Error:", error.message);
  }
};



