'use client';

import { useState } from 'react';
import { ArrowRight, Terminal, Database, Lock, Layout, CheckCircle2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { InteractiveDemo } from '../components/demo/InteractiveDemo';
import { RequestAccessModal } from '../components/landing/RequestAccessModal';
import { submitWaitlist } from './actions';

export default function Home() {
  const [email, setEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [isDemoActive, setIsDemoActive] = useState(false);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaitlistStatus('loading');
    
    const formData = new FormData();
    formData.append('email', email);

    try {
        const result = await submitWaitlist({}, formData);
        if (result.success) {
            setWaitlistStatus('success');
            setTimeout(() => setWaitlistStatus('idle'), 3000);
            setEmail('');
        } else {
            setWaitlistStatus('error');
            console.error(result.error);
        }
    } catch (e) {
        setWaitlistStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-white/20">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-black/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-xl tracking-tight text-white">
            <div className="w-5 h-5 rounded-sm bg-white" />
            Orbitae
          </div>
          <RequestAccessModal>
              <button 
                className="text-sm font-medium text-white/80 hover:text-white transition-colors border border-white/10 hover:border-white/20 px-4 py-2 rounded-full"
              >
                Request Alpha Access
              </button>
          </RequestAccessModal>
        </div>
      </nav>

      <main className="pt-32 pb-20">
        {/* Hero Section */}
        <section className="max-w-7xl mx-auto px-6 mb-32">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center max-w-4xl mx-auto space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-white/20 bg-white/5 text-xs font-medium text-white/80 mb-8">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_10px_rgba(52,211,153,0.5)]" />
              Now in Private Alpha
            </div>
            
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
              The Native Workspace <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60">
                for Software Developers
              </span>
            </h1>
            
            <p className="text-xl text-neutral-400 max-w-2xl mx-auto leading-relaxed">
              Stop context switching. Manage your projects, terminals, databases, and secrets in one native, high-performance workspace.
            </p>

            <form onSubmit={handleWaitlistSubmit} className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto pt-8">
              <input
                type="email"
                required
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-12 px-4 rounded-lg bg-neutral-900 border border-neutral-800 focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/40 transition-all placeholder:text-neutral-600 text-white"
              />
              <button 
                type="submit"
                disabled={waitlistStatus === 'loading' || waitlistStatus === 'success'}
                className="w-full sm:w-auto h-12 px-8 rounded-lg bg-white text-black font-semibold hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 min-w-[140px]"
              >
                {waitlistStatus === 'loading' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                ) : waitlistStatus === 'success' ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    Joined!
                  </>
                ) : (
                  <>
                    Join Waitlist
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
            <p className="text-xs text-neutral-500 pt-4">
              Join numerous developers waiting for access. No spam, ever.
            </p>
          </motion.div>
        </section>

        {/* Interactive Demo */}
        <section className="max-w-6xl mx-auto px-6 mb-40 min-h-[600px] flex flex-col items-center justify-center relative">
           {!isDemoActive && (
              <motion.div 
                className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-gradient-to-t from-black via-black/80 to-transparent p-6 rounded-xl border border-white/10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                 <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setIsDemoActive(true)}
                    className="px-8 py-4 bg-white text-black text-lg font-bold rounded-full shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)] transition-shadow flex items-center gap-3"
                 >
                    <Terminal className="w-5 h-5" />
                    Play Around
                 </motion.button>
                 <div className="mt-6 flex flex-col items-center gap-1">
                    <p className="text-neutral-400 text-sm font-medium">
                        Interactive Demo • No account required
                    </p>
                    <p className="text-neutral-600 text-xs max-w-sm text-center">
                        (This is a simulated demo version running in your browser. It does not access your actual filesystem or databases.)
                    </p>
                 </div>
              </motion.div>
           )}

           <motion.div
              layout
              className={`w-full relative transition-all duration-700 ease-in-out ${isDemoActive ? 'scale-100 opacity-100' : 'scale-[0.98] opacity-50 blur-[2px] pointer-events-none'}`}
           >
              <InteractiveDemo />
           </motion.div>
        </section>

        {/* Features Grid */}
        <section className="max-w-7xl mx-auto px-6 grid md:grid-cols-3 gap-8 mb-40">
          {[
            {
              icon: Layout,
              title: "Native Performance",
              desc: "Built with Rust and Tauri. Uses <50MB RAM idle compared to 500MB+ for Electron apps."
            },
            {
              icon: Lock,
              title: "Vault Security",
              desc: "Secrets are encrypted using the Secure Enclave. Never store .env files in plain text again."
            },
            {
              icon: Terminal,
              title: "Context Retention",
              desc: "Workspaces remember your terminal state, database connections, and notes automatically."
            }
          ].map((feature, i) => (
            <div key={i} className="p-8 rounded-2xl bg-neutral-900/30 border border-neutral-800 hover:bg-neutral-900/50 hover:border-neutral-700 transition-colors duration-300">
              <feature.icon className="w-8 h-8 text-white mb-4" />
              <h3 className="text-xl font-bold mb-2 text-white">{feature.title}</h3>
              <p className="text-neutral-400 leading-relaxed">{feature.desc}</p>
            </div>
          ))}
        </section>

        {/* Footer */}
        <footer className="max-w-7xl mx-auto px-6 pt-20 border-t border-neutral-800 flex flex-col md:flex-row items-center justify-between gap-6 text-sm text-neutral-500">
            <div>
               &copy; {new Date().getFullYear()} Orbitae. All rights reserved.
            </div>
            <div className="flex gap-6">
                <a href="#" className="hover:text-white transition-colors">Twitter</a>
                <a href="#" className="hover:text-white transition-colors">GitHub</a>
                <a href="#" className="hover:text-white transition-colors">Changelog</a>
            </div>
        </footer>
      </main>
    </div>
  );
}
