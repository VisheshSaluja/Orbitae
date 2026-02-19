'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { submitAlphaRequest } from '../../app/actions';

interface RequestAccessModalProps {
    children: React.ReactNode;
}

export function RequestAccessModal({ children }: RequestAccessModalProps) {
    const [open, setOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [errors, setErrors] = useState<Record<string, string[]>>({});

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setIsLoading(true);
        setErrors({});

        const formData = new FormData(e.currentTarget);
        
        try {
            // We can't pass state easily here without useFormState, but let's do a simple call for now
            // mimicking the server action call directly
            const result = await submitAlphaRequest({}, formData);
            
            if (result.success) {
                setSuccess(true);
                setTimeout(() => {
                    setOpen(false);
                    setSuccess(false); // Reset for next time
                }, 3000);
            } else if (result.errors) {
                setErrors(result.errors);
            }
        } catch (error) {
            console.error(error);
            setErrors({ form: ['Something went wrong. Please try again.'] });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {children}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto bg-neutral-900 border-neutral-800 text-white">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold">Request Alpha Access</DialogTitle>
                    <DialogDescription className="text-neutral-400">
                        Orbitae is currently in private alpha. Tell us about yourself to get early access.
                    </DialogDescription>
                </DialogHeader>

                {success ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-4">
                        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-500">
                            <CheckCircle2 className="w-8 h-8" />
                        </div>
                        <h3 className="text-xl font-semibold text-white">Request Received!</h3>
                        <p className="text-neutral-400 text-center max-w-xs">
                            We'll review your application and send an invite to your email if you're a good fit.
                        </p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input id="name" name="name" required placeholder="Jane Doe" className="bg-neutral-800 border-neutral-700" />
                                {errors.name && <p className="text-red-400 text-xs">{errors.name[0]}</p>}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="role">Role</Label>
                                <Input id="role" name="role" required placeholder="Senior Engineer" className="bg-neutral-800 border-neutral-700" />
                                {errors.role && <p className="text-red-400 text-xs">{errors.role[0]}</p>}
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="email">Work Email</Label>
                            <Input id="email" name="email" type="email" required placeholder="jane@company.com" className="bg-neutral-800 border-neutral-700" />
                            {errors.email && <p className="text-red-400 text-xs">{errors.email[0]}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="company">Company (Optional)</Label>
                            <Input id="company" name="company" placeholder="Acme Inc." className="bg-neutral-800 border-neutral-700" />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="socialUrl">GitHub / Twitter / LinkedIn URL</Label>
                            <Input id="socialUrl" name="socialUrl" type="url" required placeholder="https://github.com/jane" className="bg-neutral-800 border-neutral-700" />
                            <p className="text-xs text-neutral-500">We use this to verify you are a real developer.</p>
                            {errors.socialUrl && <p className="text-red-400 text-xs">{errors.socialUrl[0]}</p>}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="reason">Why do you want to use Orbitae?</Label>
                            <Textarea id="reason" name="reason" required placeholder="I'm tired of switching context..." className="bg-neutral-800 border-neutral-700 min-h-[80px]" />
                            {errors.reason && <p className="text-red-400 text-xs">{errors.reason[0]}</p>}
                        </div>

                        <div className="flex items-start space-x-2 pt-2">
                            <div className="flex items-center h-5">
                                <input
                                    id="agreeToNDA"
                                    name="agreeToNDA"
                                    type="checkbox"
                                    required
                                    className="w-4 h-4 rounded bg-neutral-800 border-neutral-700 text-emerald-500 focus:ring-emerald-500 focus:ring-offset-neutral-900" 
                                />
                            </div>
                            <div className="flex flex-col">
                                <Label htmlFor="agreeToNDA" className="text-sm font-normal cursor-pointer">
                                    I agree to keep the alpha binary private and not share it with others.
                                </Label>
                                {errors.agreeToNDA && <p className="text-red-400 text-xs">{errors.agreeToNDA[0]}</p>}
                            </div>
                        </div>

                        <DialogFooter className="pt-4">
                            <Button type="submit" disabled={isLoading} className="w-full bg-white text-black hover:bg-neutral-200">
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Submitting...
                                    </>
                                ) : (
                                    'Request Access'
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
