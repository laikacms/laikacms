import Head from 'next/head';
import { useEffect, useState } from 'react';

import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

interface AdminProps {
  html: string;
}

export function getServerSideProps() {
  return {
    props: {
      html: decapAdminHtml({
        decapConfig: minimalBlogConfig(),
        title: 'Admin · LaikaCMS Next Pages starter',
      }),
    },
  };
}

export default function Admin({ html }: AdminProps) {
  // Render the full Decap HTML in an iframe so React doesn't fight Decap
  // for ownership of the document. Same pattern as the App Router variant.
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(URL.createObjectURL(new Blob([html], { type: 'text/html' })));
  }, [html]);

  return (
    <>
      <Head>
        <title>Admin · LaikaCMS</title>
      </Head>
      {src
        ? (
          <iframe
            src={src}
            style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', border: 0 }}
          />
        )
        : null}
    </>
  );
}
