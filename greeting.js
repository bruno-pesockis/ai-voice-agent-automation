var LANG = 'en'; // английская Maya: 'en', испанская: 'es'

// Sample data only. The real clinic list (caller phone -> clinic name) is
// private and is loaded separately; it is not stored in this repo.
// Format: 10-digit phone, digits only -> clinic name.
const CLINICS = {
  "5550100001": "Sample Family Dental",
  "5550100002": "Example Smiles Dentistry",
  "5550100003": "Demo Bay Dental Care",
};

var callerDigits = String(typeof caller_phone === 'undefined' ? '' : caller_phone).replace(/\D/g, '').slice(-10);
demo_clinic = CLINICS[callerDigits] || 'none';

var DIGITS = LANG === 'es'
  ? ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve']
  : ['zero','one','two','three','four','five','six','seven','eight','nine'];
function speakDigits(s) {
  return s.split('').map(function (c) { return DIGITS[Number(c)]; }).join(' ');
}
if (/^\d{10}$/.test(callerDigits)) {
  caller_phone10 = callerDigits;
  caller_phone_spoken = speakDigits(callerDigits.slice(0, 3)) + ', ' + speakDigits(callerDigits.slice(3, 6)) + ', ' + speakDigits(callerDigits.slice(6));
} else {
  caller_phone10 = 'none';
  caller_phone_spoken = 'none';
}

if (LANG === 'es') {
  if (demo_clinic !== 'none') {
    greeting_text = "Gracias por llamar a " + demo_clinic + ", habla Maya, la asistente virtual de la clínica. ¿En qué le puedo ayudar?";
  } else if (office_open === 'yes') {
    greeting_text = "Gracias por llamar a Marlowe Park Family Dental, habla Maya, la asistente virtual de la clínica. La recepción está atendiendo a otros pacientes en este momento. ¿En qué le puedo ayudar?";
  } else {
    greeting_text = "Gracias por llamar a Marlowe Park Family Dental, habla Maya, la asistente virtual de la clínica. En este momento estamos cerrados. ¿En qué le puedo ayudar?";
  }
} else {
  if (demo_clinic !== 'none') {
    greeting_text = "Thanks for calling " + demo_clinic + ", this is Maya, the practice's virtual assistant. How can I help?";
  } else if (office_open === 'yes') {
    greeting_text = "Thanks for calling Marlowe Park Family Dental, this is Maya, the practice's virtual assistant. The front desk is with patients right now - how can I help?";
  } else {
    greeting_text = "Thanks for calling Marlowe Park Family Dental, this is Maya, the practice's virtual assistant. We're closed right now - how can I help?";
  }
}
