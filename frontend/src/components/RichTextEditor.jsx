import { useEffect, useRef } from 'react';
import Quill from 'quill';
import DOMPurify from 'dompurify';
import 'quill/dist/quill.snow.css';
const clean = html => DOMPurify.sanitize(html || '', {USE_PROFILES:{html:true},FORBID_TAGS:['img','video','audio','iframe','style']});

// Keep Quill's editing selection and undo history while React stores the HTML.
export default function RichTextEditor({value,onChange,modules}) {
  const host=useRef(null),editor=useRef(null),change=useRef(onChange),initial=useRef(value);
  change.current=onChange;
  useEffect(()=>{
    const node=document.createElement('div');host.current.appendChild(node);
    const quill=new Quill(node,{theme:'snow',modules});editor.current=quill;
    quill.root.setAttribute('aria-label','信件內文');quill.root.setAttribute('role','textbox');quill.root.setAttribute('aria-multiline','true');
    quill.setContents(quill.clipboard.convert({html:clean(initial.current)}),'silent');
    const listener=()=>change.current(clean(quill.getSemanticHTML()));
    quill.on('text-change',listener);
    const root=host.current;
    return()=>{quill.off('text-change',listener);editor.current=null;root.replaceChildren();};
  },[modules]);
  useEffect(()=>{
    const quill=editor.current;if(!quill||value===clean(quill.getSemanticHTML()))return;
    // External reset only; typing echoes the same HTML and does not reset the cursor.
    const selection=quill.getSelection();
    quill.setContents(quill.clipboard.convert({html:clean(value)}),'silent');
    if(selection)quill.setSelection(Math.min(selection.index,quill.getLength()-1),0,'silent');
  },[value]);
  return <div ref={host}/>;
}
