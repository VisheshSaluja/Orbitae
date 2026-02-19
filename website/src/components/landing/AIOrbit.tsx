'use client';

import { motion } from 'framer-motion';
import { Brain, Cpu, MessageSquareCode, Network, Workflow } from 'lucide-react';

export function AIOrbit() {
  return (
    <section className="py-32 px-6 relative overflow-hidden">
      {/* Background Gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-purple-950/10 to-black pointer-events-none" />

      <div className="max-w-7xl mx-auto relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          viewport={{ once: true }}
          className="text-center mb-20"
        >
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-6 bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-white">
            The Context-Aware Workspace
          </h2>
          <p className="text-xl text-neutral-400 max-w-3xl mx-auto">
            Orbitae isn't just a terminal. It's an AI-native environment that understands your
            architecture, dependencies, and tools.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-12">
          {/* Feature 1: AI Launchpad */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            viewport={{ once: true }}
            className="group relative p-8 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-purple-500/30 transition-colors"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
            
            <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center mb-6">
              <Workflow className="w-6 h-6 text-purple-400" />
            </div>
            
            <h3 className="text-2xl font-bold mb-4">Intelligent Orchestration</h3>
            <p className="text-neutral-400 leading-relaxed mb-6">
              Forget <code className="text-xs bg-white/10 px-1 py-0.5 rounded">npm run-all</code>. 
              Orbitae builds a live dependency graph of your services. It knows to wait for your 
              Database to be healthy before starting the Backend, and for the Backend API to be live 
              before launching the Frontend.
            </p>
            
            <div className="flex items-center gap-2 text-sm text-purple-400 font-medium">
              <Network className="w-4 h-4" />
              <span>DAG-based Execution</span>
            </div>
          </motion.div>

          {/* Feature 2: MCP Support */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            whileInView={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            viewport={{ once: true }}
            className="group relative p-8 rounded-2xl bg-neutral-900/50 border border-white/5 hover:border-blue-500/30 transition-colors"
          >
            <div className="absolute inset-0 bg-gradient-to-bl from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl" />
            
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mb-6">
              <Brain className="w-6 h-6 text-blue-400" />
            </div>
            
            <h3 className="text-2xl font-bold mb-4">Model Context Protocol (MCP)</h3>
            <p className="text-neutral-400 leading-relaxed mb-6">
              Give your AI agency. Connect verified MCP servers—for GitHub, Postgres, Slack, or your 
              local filesystem—directly to Orbitae. Your workspace AI agent can now safely read code, 
              query data, and automate tasks using standard protocols.
            </p>

            <div className="flex items-center gap-2 text-sm text-blue-400 font-medium">
              <MessageSquareCode className="w-4 h-4" />
              <span>Universal Tool Interface</span>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
